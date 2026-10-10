import os, uuid, base64, smtplib, json
from threading import Lock
from email.message import EmailMessage
from datetime import datetime, date, timedelta
from functools import wraps
from io import BytesIO

import cv2
import numpy as np
from flask import Flask, jsonify, request, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from backend.app.services.email_service import (
    send_verified_match_email,
    send_case_update_email,
    send_notification_email,
)

app = Flask(__name__, static_folder='frontend', static_url_path='')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'development-only-change-me')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///janraksha.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_UPLOAD_MB', 5)) * 1024 * 1024
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'uploads')
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER') or os.environ.get('SMTP_HOST') or ''
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', os.environ.get('SMTP_PORT', '587')))
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME') or os.environ.get('SMTP_USER') or ''
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD') or os.environ.get('SMTP_PASSWORD') or ''
app.config['MAIL_USE_TLS'] = str(os.environ.get('MAIL_USE_TLS', os.environ.get('SMTP_TLS', 'true'))).lower() in {'1', 'true', 'yes', 'on'}
app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER') or os.environ.get('SMTP_FROM') or 'JanRaksha AI <noreply@janraksha.local>'
app.config['POTENTIAL_MATCH_THRESHOLD'] = float(os.environ.get('POTENTIAL_MATCH_THRESHOLD', '0.80'))
if not 0 <= app.config['POTENTIAL_MATCH_THRESHOLD'] <= 1:
    raise ValueError('POTENTIAL_MATCH_THRESHOLD must be between 0 and 1.')
db = SQLAlchemy(app)
webcam_tracks = {}
webcam_tracks_lock = Lock()

ROLES = {'FAMILY_USER', 'CITIZEN', 'INVESTIGATOR', 'ADMIN_DEMO'}
CASE_STATUSES = {'ACTIVE', 'UNDER REVIEW', 'RELEVANT LEAD', 'PERSON_FOUND', 'PERSON FOUND', 'CLOSED'}
MATCH_STATUSES = {'REQUIRES_HUMAN_VERIFICATION', 'VERIFIED_BY_AUTHORIZED_USER', 'NOT_RELEVANT'}


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True); name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False, index=True); phone = db.Column(db.String(30))
    password_hash = db.Column(db.String(256), nullable=False); role = db.Column(db.String(30), nullable=False)
    location = db.Column(db.String(180)); created_at = db.Column(db.DateTime, default=datetime.utcnow)


class MissingPerson(db.Model):
    id = db.Column(db.Integer, primary_key=True); case_id = db.Column(db.String(20), unique=True, nullable=False, index=True)
    registered_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False); name = db.Column(db.String(120), nullable=False)
    age = db.Column(db.Integer); gender = db.Column(db.String(30)); photo = db.Column(db.String(255))
    description = db.Column(db.Text); clothing_description = db.Column(db.Text); last_seen_location = db.Column(db.String(200))
    latitude = db.Column(db.Float); longitude = db.Column(db.Float); last_seen_date = db.Column(db.Date)
    last_seen_time = db.Column(db.String(10)); status = db.Column(db.String(30), default='ACTIVE'); created_at = db.Column(db.DateTime, default=datetime.utcnow)


class FaceEmbedding(db.Model):
    id = db.Column(db.Integer, primary_key=True); missing_person_id = db.Column(db.Integer, db.ForeignKey('missing_person.id'), nullable=False)
    embedding_vector = db.Column(db.Text, nullable=False); model_name = db.Column(db.String(80)); embedding_dimension = db.Column(db.Integer); created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Sighting(db.Model):
    id = db.Column(db.Integer, primary_key=True); case_id = db.Column(db.String(20)); reported_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    photo = db.Column(db.String(255)); description = db.Column(db.Text); location_name = db.Column(db.String(200)); latitude = db.Column(db.Float); longitude = db.Column(db.Float)
    reported_at = db.Column(db.DateTime, default=datetime.utcnow); status = db.Column(db.String(30), default='SUBMITTED')


class FoundPerson(db.Model):
    id = db.Column(db.Integer, primary_key=True); reported_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    photo = db.Column(db.String(255)); description = db.Column(db.Text); location_name = db.Column(db.String(200)); latitude = db.Column(db.Float); longitude = db.Column(db.Float)
    found_date = db.Column(db.Date); status = db.Column(db.String(30), default='SUBMITTED'); matched_case_id = db.Column(db.String(20)); verification_status = db.Column(db.String(30), default='PENDING_HUMAN_REVIEW')
    verified_by = db.Column(db.Integer, db.ForeignKey('user.id')); verified_at = db.Column(db.DateTime); verified_location = db.Column(db.String(200)); verified_found = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class AIMatch(db.Model):
    id = db.Column(db.Integer, primary_key=True); source_type = db.Column(db.String(30)); source_id = db.Column(db.Integer)
    missing_person_id = db.Column(db.Integer, db.ForeignKey('missing_person.id')); similarity_score = db.Column(db.Float); combined_score = db.Column(db.Float)
    status = db.Column(db.String(50), default='REQUIRES_HUMAN_VERIFICATION'); created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Timeline(db.Model):
    id = db.Column(db.Integer, primary_key=True); case_id = db.Column(db.String(20), index=True); event_type = db.Column(db.String(80)); description = db.Column(db.Text)
    created_by = db.Column(db.Integer); created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Notification(db.Model):
    id = db.Column(db.Integer, primary_key=True); user_id = db.Column(db.Integer, db.ForeignKey('user.id')); title = db.Column(db.String(150)); message = db.Column(db.Text)
    type = db.Column(db.String(30), default='info'); is_read = db.Column(db.Boolean, default=False); created_at = db.Column(db.DateTime, default=datetime.utcnow)


class EmailNotification(db.Model):
    __tablename__ = 'email_notifications'
    id = db.Column(db.Integer, primary_key=True)
    case_id = db.Column(db.String(20), index=True)
    match_id = db.Column(db.Integer, db.ForeignKey('ai_match.id'))
    recipient_user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    recipient_email = db.Column(db.String(200))
    notification_type = db.Column(db.String(80), default='VERIFIED_MATCH')
    subject = db.Column(db.String(200))
    status = db.Column(db.String(20), default='PENDING')
    attempt_count = db.Column(db.Integer, default=0)
    sent_at = db.Column(db.DateTime)
    failure_reason = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AuditLog(db.Model):
    __tablename__ = 'audit_logs'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    case_id = db.Column(db.String(20), index=True)
    match_id = db.Column(db.Integer)
    action = db.Column(db.String(80), nullable=False, index=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    ip_address = db.Column(db.String(64))
    meta = db.Column('metadata', db.Text)


class InvestigationNote(db.Model):
    id = db.Column(db.Integer, primary_key=True); case_id = db.Column(db.String(20)); author_id = db.Column(db.Integer); body = db.Column(db.Text); created_at = db.Column(db.DateTime, default=datetime.utcnow)


class WebcamSession(db.Model):
    __tablename__ = 'webcam_sessions'
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(40), unique=True, nullable=False, index=True)
    investigator_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    location_name = db.Column(db.String(200))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    monitoring_description = db.Column(db.Text)
    started_at = db.Column(db.DateTime, default=datetime.utcnow)
    ended_at = db.Column(db.DateTime)
    status = db.Column(db.String(30), default='ACTIVE')
    faces_processed = db.Column(db.Integer, default=0)
    potential_matches = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class WebcamDetection(db.Model):
    __tablename__ = 'webcam_detections'
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(40), db.ForeignKey('webcam_sessions.session_id'), nullable=False, index=True)
    case_id = db.Column(db.String(20), index=True)
    similarity_score = db.Column(db.Float)
    frame_timestamp = db.Column(db.String(40))
    status = db.Column(db.String(40), default='POTENTIAL_MATCH')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class EmergencyContact(db.Model):
    id = db.Column(db.Integer, primary_key=True); name = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(40), nullable=False); region = db.Column(db.String(160)); instructions = db.Column(db.Text)
    is_active = db.Column(db.Boolean, default=True)


class TrustedContact(db.Model):
    id = db.Column(db.Integer, primary_key=True); user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False); email = db.Column(db.String(160)); phone = db.Column(db.String(40)); created_at = db.Column(db.DateTime, default=datetime.utcnow)


class EmergencyEvent(db.Model):
    id = db.Column(db.Integer, primary_key=True); user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    status = db.Column(db.String(20), default='ACTIVE'); latitude = db.Column(db.Float); longitude = db.Column(db.Float)
    location_name = db.Column(db.String(200)); message = db.Column(db.Text); created_at = db.Column(db.DateTime, default=datetime.utcnow); cancelled_at = db.Column(db.DateTime)


def normalize_match_status(value):
    return (value or '').upper().replace(' ', '_')


def normalize_case_status(value):
    return (value or '').upper().replace(' ', '_')


def display_case_status(value):
    value = normalize_case_status(value)
    return value.replace('_', ' ')


def display_match_status(value):
    return normalize_match_status(value).replace('_', ' ')


def add_audit_log(user_id=None, case_id=None, match_id=None, action='ACTION', metadata=None, ip_address=None):
    db.session.add(AuditLog(user_id=user_id, case_id=case_id, match_id=match_id, action=action, timestamp=datetime.utcnow(), ip_address=ip_address, meta=json.dumps(metadata or {})))


def api_error(message, status=400):
    return jsonify(error=message), status


def current_user():
    return db.session.get(User, session.get('user_id')) if session.get('user_id') else None


def require_auth(roles=None):
    def outer(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = current_user()
            if not user:
                return api_error('Authentication required.', 401)
            if roles and user.role not in roles:
                return api_error('You do not have permission.', 403)
            return fn(*args, **kwargs)
        return wrapped
    return outer


def user_json(u):
    return {'id': u.id, 'name': u.name, 'email': u.email, 'role': u.role, 'location': u.location}


def person_json(p):
    return {'id': p.id, 'case_id': p.case_id, 'name': p.name, 'age': p.age, 'gender': p.gender, 'photo': p.photo,
            'description': p.description, 'clothing_description': p.clothing_description, 'last_seen_location': p.last_seen_location,
            'latitude': p.latitude, 'longitude': p.longitude, 'last_seen_date': p.last_seen_date.isoformat() if p.last_seen_date else None,
            'last_seen_time': p.last_seen_time, 'status': p.status, 'created_at': p.created_at.isoformat()}


def next_case_id():
    yr = datetime.utcnow().year; prefix = f'JR-{yr}-'; last = MissingPerson.query.filter(MissingPerson.case_id.like(prefix + '%')).order_by(MissingPerson.case_id.desc()).first()
    n = int(last.case_id[-4:]) + 1 if last else 1; return f'{prefix}{n:04d}'


def save_file(file):
    if not file or not file.filename:
        return None
    ext = os.path.splitext(secure_filename(file.filename))[1].lower()
    if ext not in {'.jpg', '.jpeg', '.png'}:
        raise ValueError('Only JPG, JPEG and PNG images are accepted.')
    name = f'{uuid.uuid4().hex}{ext}'
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    file.save(os.path.join(app.config['UPLOAD_FOLDER'], name))
    return f'/uploads/{name}'


def next_webcam_session_id():
    prefix = f'WC-{datetime.utcnow().year}-'
    last = WebcamSession.query.filter(WebcamSession.session_id.like(prefix + '%')).order_by(WebcamSession.session_id.desc()).first()
    n = int(last.session_id[-5:]) + 1 if last else 1
    return f'{prefix}{n:05d}'


def _safe_haar_cascade(model_name):
    if not hasattr(cv2, 'CascadeClassifier'):
        return None
    data_dir = getattr(cv2, 'data', None)
    cascade_candidates = []
    if data_dir is not None and hasattr(data_dir, 'haarcascades'):
        cascade_path = os.path.join(data_dir.haarcascades, model_name)
        if os.path.exists(cascade_path):
            cascade_candidates.append(cascade_path)
    cascade_candidates.append(None)
    for candidate in cascade_candidates:
        try:
            cascade = cv2.CascadeClassifier(candidate) if candidate else cv2.CascadeClassifier()
        except TypeError:
            continue
        except Exception:
            continue
        if cascade is None:
            continue
        if hasattr(cascade, 'empty') and callable(cascade.empty):
            try:
                if cascade.empty():
                    continue
            except Exception:
                pass
        return cascade
    return None


def detect_multiple_faces(frame_path):
    image = cv2.imread(frame_path)
    if image is None:
        raise ValueError('The webcam frame could not be read.')
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    cascade = _safe_haar_cascade('haarcascade_frontalface_default.xml')
    if cascade is None:
        version = getattr(cv2, '__version__', 'unknown')
        raise ValueError(
            f'Face scanning requires OpenCV 4.x with Haar support (detected OpenCV {version}). '
            r'Run JanRaksha with .venv\Scripts\python.exe after installing requirements.txt.'
        )
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(32, 32))
    if len(faces) == 0:
        return []
    return [{'x': int(x), 'y': int(y), 'width': int(w), 'height': int(h)} for x, y, w, h in sorted(faces, key=lambda item: item[2] * item[3], reverse=True)]


def _face_quality_metrics(face_image):
    if face_image is None or face_image.size == 0:
        return {'ok': False, 'reason': 'The detected face could not be read.', 'quality_score': 0.0, 'pose_score': 0.0}
    if len(face_image.shape) == 3:
        gray = cv2.cvtColor(face_image, cv2.COLOR_BGR2GRAY)
    else:
        gray = face_image
    height, width = gray.shape[:2]
    if width < 64 or height < 64:
        return {'ok': False, 'reason': 'The detected face is too small.', 'quality_score': 0.0, 'pose_score': 0.0}
    if not 0.55 <= width / height <= 1.45:
        return {'ok': False, 'reason': 'The detected face geometry is distorted.', 'quality_score': 0.0, 'pose_score': 0.0}
    brightness = float(np.mean(gray))
    exposure = float(np.mean(gray >= 245))
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    detail = float(np.std(gray))
    quality_score = 1.0
    if brightness < 35:
        quality_score *= 0.35
    if exposure > 0.7:
        quality_score *= 0.40
    if blur < 20:
        quality_score *= 0.55
    if detail < 18:
        quality_score *= 0.55
    eye_cascade = _safe_haar_cascade('haarcascade_eye_tree_eyaglasses.xml')
    pose_score = 1.0
    if eye_cascade is not None:
        upper_face = gray[:max(1, int(height * 0.7)), :]
        eyes = eye_cascade.detectMultiScale(upper_face, scaleFactor=1.1, minNeighbors=4, minSize=(8, 8))
        if len(eyes) < 2:
            pose_score = 0.55
            quality_score *= 0.85
    else:
        pose_score = 0.5
        quality_score *= 0.75
    quality_score = max(0.0, min(1.0, quality_score))
    ok = quality_score >= 0.15 and pose_score >= 0.20
    if not ok:
        if brightness < 35:
            reason = 'The detected face is too dark.'
        elif exposure > 0.7:
            reason = 'The detected face is overexposed.'
        elif blur < 20:
            reason = 'The detected face is too blurred.'
        elif detail < 18:
            reason = 'The detected face has insufficient detail.'
        else:
            reason = 'Facial features are obscured or not sufficiently visible.'
        return {'ok': False, 'reason': reason, 'quality_score': quality_score, 'pose_score': pose_score}
    return {'ok': True, 'reason': None, 'quality_score': quality_score, 'pose_score': pose_score}


def assess_face_quality(face_image):
    metrics = _face_quality_metrics(face_image)
    return metrics['ok'], metrics['reason']


def _alignment_and_resize(face_image):
    image = face_image.copy()
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    if gray.shape[0] == 0 or gray.shape[1] == 0:
        return gray.astype(np.float32)
    eye_cascade = _safe_haar_cascade('haarcascade_eye_tree_eyeglasses.xml')
    eyes = []
    if eye_cascade is not None:
        try:
            eyes = eye_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(10, 10))
        except Exception:
            eyes = []
    if len(eyes) >= 2:
        eyes = sorted(eyes, key=lambda item: item[0])
        left_eye = eyes[0]
        right_eye = eyes[-1]
        left_center = (left_eye[0] + left_eye[2] / 2, left_eye[1] + left_eye[3] / 2)
        right_center = (right_eye[0] + right_eye[2] / 2, right_eye[1] + right_eye[3] / 2)
        angle = np.degrees(np.arctan2(right_center[1] - left_center[1], right_center[0] - left_center[0]))
        rotation_matrix = cv2.getRotationMatrix2D((gray.shape[1] / 2, gray.shape[0] / 2), -angle, 1.0)
        image = cv2.warpAffine(image, rotation_matrix, (gray.shape[1], gray.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    gray = cv2.equalizeHist(gray)
    resized = cv2.resize(gray, (96, 96), interpolation=cv2.INTER_AREA)
    resized = resized.astype(np.float32)
    resized = (resized - resized.mean()) / (resized.std() + 1e-6)
    return resized


def _reference_agreement(similarity_score):
    if similarity_score >= 92:
        return 1.0
    if similarity_score >= 82:
        return 0.8
    if similarity_score >= 72:
        return 0.6
    return 0.4


def _face_match_evidence(similarity_score, quality_score, pose_score, reference_score=1.0, temporal_score=1.0, context_score=0.8):
    combined = (
        similarity_score * 0.45 +
        quality_score * 100 * 0.25 +
        pose_score * 100 * 0.15 +
        reference_score * 100 * 0.1 +
        temporal_score * 100 * 0.05 +
        context_score * 100 * 0.05
    )
    return float(np.clip(combined, 0, 100))


def search_missing_persons(embedding, source_type=None, source_id=None, similarity_threshold=55.0, record_matches=True):
    vector = np.asarray(embedding, dtype=np.float32)
    grouped = {}
    for row in FaceEmbedding.query.all():
        stored = np.array(json.loads(row.embedding_vector), dtype=np.float32)
        if stored.size != vector.size:
            continue
        score = float(np.clip(np.dot(vector, stored), -1, 1))
        similarity = min(99.9, round((score + 1) * 50, 1))
        if similarity < similarity_threshold:
            continue
        person = db.session.get(MissingPerson, row.missing_person_id)
        if not person:
            continue
        entry = grouped.setdefault(person.id, {'person': person, 'best_similarity': 0.0, 'best_evidence': 0.0})
        evidence = _face_match_evidence(similarity, 0.9, 0.9, _reference_agreement(similarity), 1.0, 0.8)
        entry['best_similarity'] = max(entry['best_similarity'], similarity)
        entry['best_evidence'] = max(entry['best_evidence'], evidence)
    results = []
    for entry in grouped.values():
        if entry['best_evidence'] >= 80:
            results.append({'person': entry['person'], 'similarity': round(entry['best_similarity'], 1), 'combined_score': round(entry['best_evidence'], 1)})
    results.sort(key=lambda item: item['combined_score'], reverse=True)
    results = results[:10]
    if record_matches:
        for result in results:
            db.session.add(AIMatch(source_type=source_type, source_id=source_id, missing_person_id=result['person'].id,
                                  similarity_score=result['similarity'], combined_score=result['combined_score'],
                                  status='REQUIRES_HUMAN_VERIFICATION'))
    return results


def _bbox_iou(first, second):
    left = max(first['x'], second['x'])
    top = max(first['y'], second['y'])
    right = min(first['x'] + first['width'], second['x'] + second['width'])
    bottom = min(first['y'] + first['height'], second['y'] + second['height'])
    intersection = max(0, right - left) * max(0, bottom - top)
    union = first['width'] * first['height'] + second['width'] * second['height'] - intersection
    return intersection / union if union else 0


def assign_webcam_face_tracks(session_id, faces):
    now = datetime.utcnow()
    with webcam_tracks_lock:
        state = webcam_tracks.setdefault(session_id, {'next_id': 1, 'faces': {}})
        tracked_faces = state['faces']
        for face_id, track in list(tracked_faces.items()):
            if (now - track['last_seen']).total_seconds() > 10:
                del tracked_faces[face_id]

        assignments = []
        unused = set(tracked_faces)
        for bbox in faces:
            candidates = []
            for existing_id in unused:
                previous = tracked_faces[existing_id]['bbox']
                overlap = _bbox_iou(bbox, previous)
                center_x = bbox['x'] + bbox['width'] / 2
                center_y = bbox['y'] + bbox['height'] / 2
                previous_x = previous['x'] + previous['width'] / 2
                previous_y = previous['y'] + previous['height'] / 2
                scale = max(bbox['width'], bbox['height'], previous['width'], previous['height'])
                distance = np.hypot(center_x - previous_x, center_y - previous_y) / max(scale, 1)
                area_ratio = max(
                    bbox['width'] * bbox['height'],
                    previous['width'] * previous['height'],
                ) / max(min(
                    bbox['width'] * bbox['height'],
                    previous['width'] * previous['height'],
                ), 1)
                if overlap >= 0.1 or (distance <= 1.25 and area_ratio <= 2):
                    candidates.append((existing_id, max(overlap, 0.1 * (1.25 - distance))))
            face_id, _ = max(candidates, key=lambda candidate: candidate[1], default=(None, 0))
            if face_id is None:
                face_id = f'face_{state["next_id"]:02d}'
                state['next_id'] += 1
                tracked_faces[face_id] = {'bbox': bbox, 'last_seen': now, 'result': None, 'last_processed': None}
            else:
                unused.remove(face_id)
                track = tracked_faces[face_id]
                track['bbox'] = bbox
                track['last_seen'] = now

            track = tracked_faces[face_id]
            cached_result = track['result']
            processed_at = track['last_processed']
            cache_valid = cached_result is not None and (
                cached_result['status'] == 'POTENTIAL_MATCH'
                or (processed_at and (now - processed_at).total_seconds() < 8)
            )
            assignments.append((face_id, cached_result if cache_valid else None))
        return assignments


def cache_webcam_face_result(session_id, face_id, result):
    with webcam_tracks_lock:
        track = webcam_tracks.get(session_id, {}).get('faces', {}).get(face_id)
        if track is not None:
            track['result'] = result
            track['last_processed'] = datetime.utcnow()


def generate_embedding(face_path):
    image = cv2.imread(face_path) if isinstance(face_path, str) else face_path
    if image is None:
        raise ValueError('The face crop could not be read.')
    normalized = _alignment_and_resize(image)
    vector = normalized.flatten()
    norm = np.linalg.norm(vector)
    if norm <= 1e-6:
        vector = np.full(vector.shape, 1 / np.sqrt(vector.size), dtype=np.float32)
    else:
        vector = vector / norm
    return vector.astype(np.float32)


def search_missing_persons(embedding, source_type=None, source_id=None, similarity_threshold=55.0, record_matches=True):
    vector = np.asarray(embedding, dtype=np.float32)
    grouped = {}
    for row in FaceEmbedding.query.all():
        stored = np.array(json.loads(row.embedding_vector), dtype=np.float32)
        if stored.size != vector.size:
            continue
        score = float(np.clip(np.dot(vector, stored), -1, 1))
        similarity = min(99.9, round((score + 1) * 50, 1))
        if similarity < similarity_threshold:
            continue
        person = db.session.get(MissingPerson, row.missing_person_id)
        if not person:
            continue
        entry = grouped.setdefault(person.id, {'person': person, 'best_similarity': 0.0, 'best_evidence': 0.0})
        evidence = _face_match_evidence(similarity, 0.9, 0.9, _reference_agreement(similarity), 1.0, 0.8)
        entry['best_similarity'] = max(entry['best_similarity'], similarity)
        entry['best_evidence'] = max(entry['best_evidence'], evidence)
    results = []
    for entry in grouped.values():
        if entry['best_evidence'] >= 80:
            results.append({'person': entry['person'], 'similarity': round(entry['best_similarity'], 1), 'combined_score': round(entry['best_evidence'], 1)})
    results.sort(key=lambda item: item['combined_score'], reverse=True)
    results = results[:10]
    if record_matches:
        for result in results:
            db.session.add(AIMatch(source_type=source_type, source_id=source_id, missing_person_id=result['person'].id,
                                  similarity_score=result['similarity'], combined_score=result['combined_score'],
                                  status='REQUIRES_HUMAN_VERIFICATION'))
    return results


def embedding_from_file(path):
    """Fallback adapter: OpenCV detection + normalized image descriptor. Swap this function for ArcFace/FaceNet in production."""
    image = cv2.imread(path)
    if image is None:
        raise ValueError('The uploaded image could not be read.')
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = []
    if hasattr(cv2, 'CascadeClassifier'):
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        faces = cascade.detectMultiScale(gray, 1.15, 5)
    if len(faces):
        x, y, w, h = max(faces, key=lambda v: v[2] * v[3])
        gray = gray[y:y + h, x:x + w]
    gray = cv2.resize(gray, (32, 16)).astype(np.float32).flatten()
    gray = (gray - gray.mean()) / (gray.std() + 1e-6)
    norm = np.linalg.norm(gray)
    return gray / norm if norm > 1e-6 else np.full(gray.shape, 1 / np.sqrt(len(gray)), dtype=np.float32)


def search_embedding(vector, source_type=None, source_id=None):
    return search_missing_persons(vector, source_type=source_type, source_id=source_id)


def match_chart_data(matches):
    if not matches:
        return None
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import pandas as pd
    import seaborn as sns

    rows = [{'case_id': row['person'].case_id, 'score': row['similarity']} for row in matches]
    chart_data = pd.DataFrame(rows).sort_values('score', ascending=True)
    figure, axis = plt.subplots(figsize=(8, max(2.2, len(rows) * 0.48)))
    sns.barplot(data=chart_data, x='score', y='case_id', color='#198754', orient='h', ax=axis)
    axis.set(xlim=(0, 115), xlabel='Similarity score (%)', ylabel='Case ID', title='Ranked identification leads')
    for bars in axis.containers:
        axis.bar_label(bars, labels=[f'{bar.get_width():.1f}%' for bar in bars], padding=4, fontsize=9)
    axis.grid(axis='x', alpha=0.2)
    figure.tight_layout()
    output = BytesIO(); figure.savefig(output, format='png', dpi=140, bbox_inches='tight'); plt.close(figure)
    encoded = base64.b64encode(output.getvalue()).decode('ascii')
    return f'data:image/png;base64,{encoded}'


def apply_exclusion(matches, exclude_case_id=None):
    if not exclude_case_id:
        return matches
    return [m for m in matches if m.get('person') and m['person'].case_id != exclude_case_id]


def add_timeline(case_id, event, desc, user_id=None):
    db.session.add(Timeline(case_id=case_id, event_type=event, description=desc, created_by=user_id))


def notify_case(case_id, title, message, user_id=None, notification_type='case'):
    p = MissingPerson.query.filter_by(case_id=case_id).first()
    if p:
        target_user = user_id if user_id is not None else p.registered_by
        db.session.add(Notification(user_id=target_user, title=title, message=message, type=notification_type))


def send_email(recipient, subject, message):
    """Sends only when SMTP is configured; in-app notification is always retained."""
    host = app.config.get('MAIL_SERVER') or os.environ.get('SMTP_HOST')
    sender = app.config.get('MAIL_DEFAULT_SENDER') or os.environ.get('SMTP_FROM')
    username = app.config.get('MAIL_USERNAME') or os.environ.get('SMTP_USER')
    password = app.config.get('MAIL_PASSWORD') or os.environ.get('SMTP_PASSWORD')
    if not recipient or not host or not sender:
        return False
    try:
        email = EmailMessage(); email['Subject'] = subject; email['From'] = sender; email['To'] = recipient; email.set_content(message)
        with smtplib.SMTP(host, int(app.config.get('MAIL_PORT') or os.environ.get('SMTP_PORT', '587')), timeout=10) as client:
            if app.config.get('MAIL_USE_TLS') or str(os.environ.get('SMTP_TLS', 'true')).lower() in {'1', 'true', 'yes', 'on'}:
                client.starttls()
            if username:
                client.login(username, password or '')
            client.send_message(email)
        return True
    except Exception:
        app.logger.warning('Could not deliver email alert.', exc_info=True)
        return False


def send_case_email(case_id, subject, message):
    p = MissingPerson.query.filter_by(case_id=case_id).first(); owner = db.session.get(User, p.registered_by) if p else None
    return send_email(owner.email if owner else None, subject, message + '\n\nThis is an AI-assisted potential lead. It requires authorized human verification.')


def send_app_index():
    response = send_from_directory('frontend', 'index.html')
    response.headers['Cache-Control'] = 'no-store, max-age=0'
    return response


@app.get('/')
def index():
    return send_app_index()


@app.get('/investigator/matches/<int:match_id>')
def investigator_match_page(match_id):
    return send_app_index()


@app.get('/uploads/<path:name>')
def uploads(name):
    return send_from_directory(app.config['UPLOAD_FOLDER'], name)


@app.post('/api/auth/register')
def register():
    d = request.get_json() or {}; email = (d.get('email') or '').strip().lower(); role = d.get('role', 'FAMILY_USER')
    if not all([d.get('name'), email, d.get('password'), d.get('terms')]):
        return api_error('Name, email, password and terms acceptance are required.')
    if role not in ROLES:
        return api_error('Invalid role.')
    if User.query.filter_by(email=email).first():
        return api_error('An account with that email already exists.', 409)
    u = User(name=d['name'].strip(), email=email, phone=d.get('phone'), password_hash=generate_password_hash(d['password']), role=role, location=d.get('location'))
    db.session.add(u); db.session.commit(); session['user_id'] = u.id; return jsonify(user=user_json(u)), 201


@app.post('/api/auth/login')
def login():
    d = request.get_json() or {}; u = User.query.filter_by(email=(d.get('email') or '').lower()).first()
    if not u or not check_password_hash(u.password_hash, d.get('password', '')):
        return api_error('Invalid email or password.', 401)
    session['user_id'] = u.id; return jsonify(user=user_json(u))


@app.post('/api/auth/logout')
def logout():
    session.clear(); return jsonify(message='Signed out.')


@app.get('/api/users/me')
@require_auth()
def me():
    return jsonify(user=user_json(current_user()))


@app.get('/webcam-search')
def webcam_search_page():
    return send_app_index()


@app.post('/api/ai/webcam/start')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def webcam_start():
    payload = request.get_json(silent=True) or {}
    session_record = WebcamSession(
        session_id=next_webcam_session_id(),
        investigator_id=current_user().id,
        location_name=(payload.get('location_name') or '').strip() or None,
        latitude=float(payload['latitude']) if payload.get('latitude') not in (None, '') else None,
        longitude=float(payload['longitude']) if payload.get('longitude') not in (None, '') else None,
        monitoring_description=(payload.get('monitoring_description') or '').strip() or None,
        status='ACTIVE',
    )
    db.session.add(session_record)
    db.session.commit()
    return jsonify(success=True, session={
        'id': session_record.id,
        'session_id': session_record.session_id,
        'investigator_id': session_record.investigator_id,
        'location_name': session_record.location_name,
        'latitude': session_record.latitude,
        'longitude': session_record.longitude,
        'monitoring_description': session_record.monitoring_description,
        'status': session_record.status,
        'started_at': session_record.started_at.isoformat(),
    })


@app.post('/api/ai/webcam/process-frame')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def webcam_process_frame():
    session_id = (request.form.get('session_id') or '').strip() or (request.get_json(silent=True) or {}).get('session_id')
    if not session_id:
        return api_error('A valid webcam session ID is required.', 400)
    session_record = WebcamSession.query.filter_by(session_id=session_id).first()
    if not session_record:
        return api_error('Webcam session not found.', 404)
    if session_record.status != 'ACTIVE':
        return api_error('This monitoring session is not active.', 409)
    if 'frame' not in request.files:
        return api_error('A webcam frame is required.', 400)
    frame_file = request.files['frame']
    if not frame_file.filename:
        return api_error('A valid frame file is required.', 400)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], f'webcam_{uuid.uuid4().hex}{os.path.splitext(secure_filename(frame_file.filename))[1].lower() or ".jpg"}')
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    frame_file.save(file_path)
    try:
        faces = detect_multiple_faces(file_path)
        assignments = assign_webcam_face_tracks(session_record.session_id, faces)
        face_results = []
        for index, (face, (face_id, _)) in enumerate(zip(faces, assignments), start=1):
            raw_crop = None
            bbox = {'x': face['x'], 'y': face['y'], 'width': face['width'], 'height': face['height']}
            try:
                image = cv2.imread(file_path)
                if image is not None:
                    raw_crop = image[face['y']:face['y'] + face['height'], face['x']:face['x'] + face['width']]
            except Exception:
                raw_crop = None

            status = 'NO_RELEVANT_MATCH'
            evidence_message = 'AI Evidence Indicator: no relevant match in the current reference set.'
            similarity_score = None
            case_id = None
            if raw_crop is not None and raw_crop.size:
                quality = _face_quality_metrics(raw_crop)
                if not quality['ok']:
                    status = 'INSUFFICIENT_QUALITY'
                    evidence_message = quality['reason']
                else:
                    embedding = generate_embedding(raw_crop)
                    matches = search_missing_persons(embedding, source_type='WEBCAM', source_id=session_record.id, record_matches=False, similarity_threshold=65.0)
                    if matches:
                        best = matches[0]
                        similarity_score = float(best['similarity'])
                        case_id = best['person'].case_id
                        status = 'POTENTIAL_MATCH' if best.get('combined_score', 0.0) >= 80 else 'NO_RELEVANT_MATCH'
                        evidence_message = 'AI Evidence Indicator: plausible relevant match requiring human review.' if status == 'POTENTIAL_MATCH' else 'AI Evidence Indicator: no relevant match in the current reference set.'
                    else:
                        evidence_message = 'AI Evidence Indicator: no relevant match in the current reference set.'
            if status == 'POTENTIAL_MATCH' and case_id:
                db.session.add(WebcamDetection(session_id=session_record.session_id, case_id=case_id, similarity_score=similarity_score, frame_timestamp=datetime.utcnow().isoformat(), status=status))
            elif status in {'NO_RELEVANT_MATCH', 'INSUFFICIENT_QUALITY'}:
                db.session.add(WebcamDetection(session_id=session_record.session_id, frame_timestamp=datetime.utcnow().isoformat(), status=status))

            face_result = {
                'face_id': face_id,
                'bbox': bbox,
                'status': status,
                'evidence_message': evidence_message,
                'index': index,
                'label': 'Face ' + str(index),
                'case_id': case_id,
                'similarity_score': similarity_score,
            }
            face_results.append(face_result)

        session_record.faces_processed = (session_record.faces_processed or 0) + len(faces)
        session_record.potential_matches = sum(1 for face in face_results if face['status'] == 'POTENTIAL_MATCH')
        db.session.commit()
        face_boxes = [
            {
                'face_id': face['face_id'],
                **face['bbox'],
                'status': face['status'],
                'label': face['label'],
            }
            for face in face_results
        ]
        results = [
            {'face_index': face['index'], 'face_id': face['face_id'], 'status': face['status'], 'evidence_message': face['evidence_message'], 'case_id': face['case_id'], 'similarity_score': face['similarity_score']}
            for face in face_results
        ]
        return jsonify(
            success=True,
            faces_detected=len(faces),
            processing='ACTIVE',
            faces=face_results,
            results=results,
            face_boxes=face_boxes,
            session_id=session_record.session_id,
            potential_matches=session_record.potential_matches,
            message='AI evidence scan completed.' if faces else 'No face detected in the current frame.',
        )
    except ValueError as exc:
        db.session.rollback()
        return api_error(str(exc), 400)
    finally:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except OSError:
            app.logger.warning('Could not remove temporary webcam image: %s', file_path)


@app.post('/api/ai/webcam/stop')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def webcam_stop():
    payload = request.get_json(silent=True) or {}
    session_id = (payload.get('session_id') or request.form.get('session_id') or '').strip()
    session_record = WebcamSession.query.filter_by(session_id=session_id).first() if session_id else None
    if not session_record:
        return api_error('Webcam session not found.', 404)
    session_record.status = 'STOPPED'; session_record.ended_at = datetime.utcnow(); db.session.commit()
    with webcam_tracks_lock:
        webcam_tracks.pop(session_record.session_id, None)
    return jsonify(success=True, message='Webcam monitoring stopped.', session={'session_id': session_record.session_id, 'status': session_record.status})


@app.get('/api/ai/webcam/session/<session_id>')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def webcam_session_details(session_id):
    session_record = WebcamSession.query.filter_by(session_id=session_id).first()
    if not session_record:
        return api_error('Webcam session not found.', 404)
    return jsonify(success=True, session={
        'id': session_record.id,
        'session_id': session_record.session_id,
        'investigator_id': session_record.investigator_id,
        'location_name': session_record.location_name,
        'latitude': session_record.latitude,
        'longitude': session_record.longitude,
        'monitoring_description': session_record.monitoring_description,
        'status': session_record.status,
        'faces_processed': session_record.faces_processed,
        'potential_matches': session_record.potential_matches,
        'started_at': session_record.started_at.isoformat(),
        'ended_at': session_record.ended_at.isoformat() if session_record.ended_at else None,
    })


@app.get('/api/ai/webcam/session/<session_id>/matches')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def webcam_session_matches(session_id):
    session_record = WebcamSession.query.filter_by(session_id=session_id).first()
    if not session_record:
        return api_error('Webcam session not found.', 404)
    rows = WebcamDetection.query.filter_by(session_id=session_id).order_by(WebcamDetection.created_at.desc()).all()
    return jsonify(success=True, matches=[{
        'id': row.id,
        'case_id': row.case_id,
        'similarity_score': row.similarity_score,
        'status': row.status,
        'frame_timestamp': row.frame_timestamp,
        'created_at': row.created_at.isoformat(),
    } for row in rows])


@app.get('/api/missing-persons')
@require_auth()
def list_people():
    q = MissingPerson.query
    term = request.args.get('q', '').strip()
    if term:
        q = q.filter(db.or_(MissingPerson.name.ilike(f'%{term}%'), MissingPerson.case_id.ilike(f'%{term}%'), MissingPerson.last_seen_location.ilike(f'%{term}%')))
    if request.args.get('status'):
        q = q.filter_by(status=request.args['status'])
    return jsonify(items=[person_json(p) for p in q.order_by(MissingPerson.created_at.desc()).all()])


@app.post('/api/missing-persons')
@require_auth({'FAMILY_USER', 'INVESTIGATOR', 'ADMIN_DEMO'})
def create_person():
    try:
        photo = save_file(request.files.get('photo')); d = request.form
        if not d.get('name') or not photo:
            return api_error('Name and photograph are required.')
        p = MissingPerson(case_id=next_case_id(), registered_by=current_user().id, name=d['name'], age=int(d['age']) if d.get('age') else None, gender=d.get('gender'), photo=photo,
                         description=d.get('description'), clothing_description=d.get('clothing_description'), last_seen_location=d.get('last_seen_location'),
                         latitude=float(d['latitude']) if d.get('latitude') else None, longitude=float(d['longitude']) if d.get('longitude') else None,
                         last_seen_date=date.fromisoformat(d['last_seen_date']) if d.get('last_seen_date') else None, last_seen_time=d.get('last_seen_time'))
        db.session.add(p); db.session.flush(); vector = embedding_from_file(os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(photo)))
        db.session.add(FaceEmbedding(missing_person_id=p.id, embedding_vector=json.dumps(vector.tolist()), model_name='opencv-fallback-descriptor', embedding_dimension=len(vector)))
        add_timeline(p.case_id, 'CASE_REGISTERED', 'Missing-person case registered.', current_user().id)
        db.session.add(Notification(user_id=current_user().id, title='Case created', message=f'{p.case_id} was created successfully.', type='success'))
        db.session.commit(); return jsonify(message='Missing-person case created successfully.', person=person_json(p)), 201
    except ValueError as e:
        return api_error(str(e))


@app.get('/api/missing-persons/<int:pid>')
@require_auth()
def get_person(pid):
    p = db.session.get(MissingPerson, pid)
    if not p:
        return api_error('Case not found.', 404)
    return jsonify(person=person_json(p), timeline=[{'event_type': x.event_type, 'description': x.description, 'created_at': x.created_at.isoformat()} for x in Timeline.query.filter_by(case_id=p.case_id).order_by(Timeline.created_at.desc())], notes=[{'body': x.body, 'created_at': x.created_at.isoformat()} for x in InvestigationNote.query.filter_by(case_id=p.case_id).all()])


@app.put('/api/missing-persons/<int:pid>')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def update_person(pid):
    p = db.session.get(MissingPerson, pid); d = request.get_json() or {}
    if not p:
        return api_error('Case not found.', 404)
    if d.get('status') not in CASE_STATUSES:
        return api_error('Invalid case status.')
    p.status = d['status']; add_timeline(p.case_id, 'STATUS_UPDATED', f'Case status updated to {display_case_status(p.status)}.', current_user().id)
    notify_case(p.case_id, 'Case status updated', f'{p.case_id} is now {display_case_status(p.status)}.')
    db.session.commit(); return jsonify(person=person_json(p))


@app.post('/api/ai/search')
@require_auth()
def ai_search():
    try:
        photo = save_file(request.files.get('photo'))
        if not photo:
            return api_error('A photograph is required.')
        exclude_case_id = (request.form.get('exclude_case_id') or '').strip()
        matches = search_embedding(embedding_from_file(os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(photo))), 'SEARCH', None)
        matches = apply_exclusion(matches, exclude_case_id)
        db.session.commit()
        return jsonify(notice='AI-generated results are potential leads and require human verification.',
                       chart=match_chart_data(matches),
                       matches=[{'case': person_json(x['person']), 'similarity_score': x['similarity'], 'assessment': 'POTENTIAL MATCH', 'status': 'REQUIRES_HUMAN_VERIFICATION'} for x in matches])
    except ValueError as e:
        return api_error(str(e))


@app.post('/api/sightings')
@require_auth()
def sighting():
    try:
        d = request.form; case = MissingPerson.query.filter_by(case_id=d.get('case_id')).first()
        if not case:
            return api_error('A valid related case ID is required.', 404)
        s = Sighting(case_id=case.case_id, reported_by=current_user().id, photo=save_file(request.files.get('photo')),
                     description=d.get('description'), location_name=d.get('location_name'),
                     latitude=float(d['latitude']) if d.get('latitude') else None, longitude=float(d['longitude']) if d.get('longitude') else None)
        db.session.add(s); add_timeline(case.case_id, 'SIGHTING_REPORTED', 'Citizen sighting submitted.', current_user().id)
        notify_case(case.case_id, 'New sighting reported', f'A new sighting was reported for {case.case_id}.')
        db.session.commit(); return jsonify(message='Sighting submitted for investigator review.'), 201
    except ValueError as e:
        return api_error(str(e))


@app.post('/api/found-persons')
@require_auth()
def found():
    try:
        d = request.form; photo = save_file(request.files.get('photo'))
        if not photo:
            return api_error('A photograph is required.')
        exclude_case_id = (d.get('exclude_case_id') or '').strip()
        report = FoundPerson(reported_by=current_user().id, photo=photo, description=d.get('description'), location_name=d.get('location_name'),
                             latitude=float(d['latitude']) if d.get('latitude') else None, longitude=float(d['longitude']) if d.get('longitude') else None,
                             found_date=date.today())
        db.session.add(report); db.session.flush(); matches = search_embedding(embedding_from_file(os.path.join(app.config['UPLOAD_FOLDER'], os.path.basename(photo))), 'FOUND_PERSON', report.id)
        matches = apply_exclusion(matches, exclude_case_id)
        db.session.commit(); return jsonify(message='Found-person report submitted. Human verification is required before any alert is sent.', report_id=report.id,
                                           chart=match_chart_data(matches),
                                           matches=[{'case': person_json(x['person']), 'case_id': x['person'].case_id, 'name': x['person'].name, 'similarity_score': x['similarity']} for x in matches]), 201
    except ValueError as e:
        return api_error(str(e))


@app.post('/api/found-persons/<int:report_id>/verify')
@require_auth()
def verify_found_person(report_id):
    d = request.get_json() or {}
    report = db.session.get(FoundPerson, report_id)
    if not report:
        return api_error('Found-person report not found.', 404)
    case_id = d.get('case_id')
    case = db.session.query(MissingPerson).filter_by(case_id=case_id).first() if case_id else None
    verified = bool(d.get('verified'))
    if verified:
        location = d.get('location_name') or report.location_name
        if not location:
            return api_error('A location is required before sending the verification alert.')
        report.verification_status = 'VERIFIED_FOUND'; report.verified_found = True; report.verified_by = current_user().id; report.verified_at = datetime.utcnow(); report.verified_location = location; report.matched_case_id = case_id
        if case:
            case.status = 'PERSON_FOUND'; add_timeline(case.case_id, 'PERSON_FOUND_VERIFIED', f'Human verification confirmed the person was found at {location}.', current_user().id)
            message = f'A human verification confirmed that {case.name} was found near {location}. Please review the case and update follow-up actions.'
            notify_case(case.case_id, 'Confirmed found person', message); send_case_email(case.case_id, 'JanRaksha AI: person found and verified', message)
        db.session.commit(); return jsonify(message='Human verification confirmed. The alert was sent to the registered case owner.', report={'id': report.id, 'verification_status': report.verification_status, 'verified_location': report.verified_location}), 200
    report.verification_status = 'VERIFIED_NOT_FOUND'; report.verified_found = False; report.verified_by = current_user().id; report.verified_at = datetime.utcnow(); report.matched_case_id = case_id
    if case:
        add_timeline(case.case_id, 'FOUND_PERSON_REJECTED', 'Human verification rejected this found-person lead.', current_user().id)
    db.session.commit(); return jsonify(message='Human verification rejected this match. No alert was sent.', report={'id': report.id, 'verification_status': report.verification_status}), 200


@app.post('/api/cases/<case_id>/notes')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def note(case_id):
    d = request.get_json() or {}
    if not d.get('body'):
        return api_error('Note text is required.')
    db.session.add(InvestigationNote(case_id=case_id, author_id=current_user().id, body=d['body']))
    add_timeline(case_id, 'INVESTIGATION_NOTE', 'Investigator added a restricted note.', current_user().id); db.session.commit(); return jsonify(message='Note added.'), 201


@app.get('/api/matches')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def matches():
    rows = AIMatch.query.order_by(AIMatch.created_at.desc()).all()
    return jsonify(items=[{'id': x.id, 'case_id': db.session.get(MissingPerson, x.missing_person_id).case_id, 'name': db.session.get(MissingPerson, x.missing_person_id).name,
                            'similarity_score': x.similarity_score, 'status': normalize_match_status(x.status), 'source_type': x.source_type,
                            'created_at': x.created_at.isoformat()} for x in rows])


@app.get('/api/matches/<int:match_id>')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def get_match(match_id):
    match = db.session.get(AIMatch, match_id)
    if not match:
        return api_error('Potential match not found.', 404)
    case = db.session.get(MissingPerson, match.missing_person_id)
    if not case:
        return api_error('Associated missing-person case not found.', 404)
    report = None
    if match.source_type == 'FOUND_PERSON':
        report = db.session.get(FoundPerson, match.source_id)
    elif match.source_type == 'WEBCAM':
        report = db.session.get(WebcamSession, match.source_id)
    report_photo = report.photo if match.source_type == 'FOUND_PERSON' and report else None
    report_description = (
        report.monitoring_description if match.source_type == 'WEBCAM' and report
        else report.description if match.source_type == 'FOUND_PERSON' and report
        else None
    )
    report_location = report.location_name if report else None
    report_timestamp = (
        report.started_at if match.source_type == 'WEBCAM' and report
        else report.created_at if match.source_type == 'FOUND_PERSON' and report
        else None
    )
    return jsonify({
        'id': match.id,
        'status': normalize_match_status(match.status),
        'similarity_score': match.similarity_score,
        'combined_score': match.combined_score,
        'missing_person': person_json(case),
        'source_type': match.source_type,
        'source_id': match.source_id,
        'report': {
            'id': report.id if report else None,
            'photo': report_photo,
            'description': report_description,
            'location_name': report_location,
            'reported_at': report_timestamp.isoformat() if report_timestamp else None,
            'reporter': user_json(db.session.get(
                User,
                report.investigator_id if match.source_type == 'WEBCAM' else report.reported_by,
            )) if report and (
                (match.source_type == 'WEBCAM' and report.investigator_id)
                or (match.source_type == 'FOUND_PERSON' and report.reported_by)
            ) else None,
            'monitoring_description': report.monitoring_description if match.source_type == 'WEBCAM' and report else None,
            'session_id': report.session_id if match.source_type == 'WEBCAM' and report else None,
        },
    })


@app.post('/api/matches/<int:match_id>/verify')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def verify_match(match_id):
    payload = request.get_json() or {}
    decision = str(payload.get('decision', '')).upper()
    match = db.session.get(AIMatch, match_id)
    if not match:
        return api_error('Potential match not found.', 404)
    if normalize_match_status(match.status) != 'REQUIRES_HUMAN_VERIFICATION':
        return api_error('This match is no longer awaiting human verification.', 409)
    if decision not in {'VERIFIED', 'NOT_RELEVANT'}:
        return api_error('Decision must be VERIFIED or NOT_RELEVANT.', 400)
    case = db.session.get(MissingPerson, match.missing_person_id)
    if not case:
        return api_error('Associated missing-person case not found.', 404)
    actor = current_user()
    notes = (payload.get('notes') or '').strip()
    if decision == 'VERIFIED':
        if not notes:
            return api_error('Verification notes are required.', 400)
        match.status = 'VERIFIED_BY_AUTHORIZED_USER'
        case.status = 'PERSON_FOUND'
        add_timeline(case.case_id, 'POTENTIAL_MATCH_VERIFIED', 'Potential match verified by authorized investigator. Case status updated to Person Found.', actor.id)
        add_audit_log(actor.id, case.case_id, match.id, 'MATCH_VERIFIED', {'decision': 'VERIFIED', 'notes': notes})
        recipient = db.session.get(User, case.registered_by)
        if not recipient or not recipient.email:
            return api_error('Registered user email is unavailable for notification.', 400)
        db.session.add(Notification(user_id=case.registered_by, title='Important Case Update',
                                  message=f'Your missing-person case {case.case_id} has been updated to Person Found after authorized verification.',
                                  type='CASE_VERIFIED'))
        notification = EmailNotification(case_id=case.case_id, match_id=match.id, recipient_user_id=recipient.id,
                                         recipient_email=recipient.email, notification_type='VERIFIED_MATCH',
                                         subject=f'JanRaksha AI — Important Update for Case {case.case_id}', status='PENDING', attempt_count=1)
        db.session.add(notification); db.session.flush()
        add_audit_log(actor.id, case.case_id, match.id, 'EMAIL_NOTIFICATION_CREATED', {'notification_id': notification.id, 'email': recipient.email})
        try:
            send_verified_match_email(case.case_id, recipient.name, recipient.email)
            notification.status = 'SENT'; notification.sent_at = datetime.utcnow(); notification.failure_reason = None
            add_audit_log(actor.id, case.case_id, match.id, 'EMAIL_SENT', {'notification_id': notification.id, 'email': recipient.email})
        except Exception as exc:
            notification.status = 'FAILED'; notification.failure_reason = str(exc)[:500]
            add_audit_log(actor.id, case.case_id, match.id, 'EMAIL_FAILED', {'notification_id': notification.id, 'reason': str(exc)[:500]})
            for admin in User.query.filter_by(role='ADMIN_DEMO').all():
                db.session.add(Notification(user_id=admin.id, title='Email delivery failed',
                                          message=f'Verified match email for case {case.case_id} could not be delivered to {recipient.email}.', type='warning'))
        db.session.commit(); return jsonify(message='✓ Match Verified Successfully', case={'case_id': case.case_id, 'status': normalize_case_status(case.status)}, match={'id': match.id, 'status': normalize_match_status(match.status)}, email={'status': notification.status, 'id': notification.id}), 200

    match.status = 'NOT_RELEVANT'; add_timeline(case.case_id, 'AI_MATCH_REVIEWED', 'AI potential match reviewed and marked not relevant.', actor.id)
    add_timeline(case.case_id, 'MATCH_RECORDED', 'No person-found notification was sent because the lead was marked not relevant.', actor.id)
    add_audit_log(actor.id, case.case_id, match.id, 'MATCH_NOT_RELEVANT', {'decision': 'NOT_RELEVANT', 'notes': notes})
    db.session.commit(); return jsonify(message='Potential match marked not relevant. The case remains active.', match={'id': match.id, 'status': normalize_match_status(match.status)}), 200


@app.post('/api/matches/<int:match_id>/not-relevant')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def mark_not_relevant(match_id):
    payload = request.get_json() or {}
    notes = (payload.get('notes') or 'Marked not relevant by authorized investigator.').strip()
    match = db.session.get(AIMatch, match_id)
    if not match:
        return api_error('Potential match not found.', 404)
    if normalize_match_status(match.status) == 'VERIFIED_BY_AUTHORIZED_USER':
        return api_error('This verified match cannot be changed to not relevant.', 409)
    match.status = 'NOT_RELEVANT';
    case = db.session.get(MissingPerson, match.missing_person_id)
    if case:
        add_timeline(case.case_id, 'AI_MATCH_REVIEWED', 'AI potential match reviewed and marked not relevant.', current_user().id)
        add_timeline(case.case_id, 'MATCH_RECORDED', 'No person-found notification was sent because the lead was marked not relevant.', current_user().id)
    add_audit_log(current_user().id, case.case_id if case else None, match.id, 'MATCH_NOT_RELEVANT', {'notes': notes})
    db.session.commit(); return jsonify(message='Potential match marked not relevant.', match={'id': match.id, 'status': normalize_match_status(match.status)}), 200


@app.post('/api/notifications/email/<int:email_id>/retry')
@require_auth({'INVESTIGATOR', 'ADMIN_DEMO'})
def retry_email(email_id):
    email_record = db.session.get(EmailNotification, email_id)
    if not email_record:
        return api_error('Email record not found.', 404)
    if email_record.status == 'SENT':
        return api_error('This email has already been delivered successfully.', 409)
    if email_record.attempt_count >= 3:
        return api_error('This email exceeds the allowed retry limit.', 429)
    case = MissingPerson.query.filter_by(case_id=email_record.case_id).first()
    if not case:
        return api_error('Associated case no longer exists.', 404)
    user = db.session.get(User, email_record.recipient_user_id) or db.session.get(User, case.registered_by)
    if not user or not user.email:
        return api_error('Registered user email cannot be resolved.', 404)
    try:
        send_verified_match_email(case.case_id, user.name, user.email)
        email_record.status = 'SENT'; email_record.sent_at = datetime.utcnow(); email_record.failure_reason = None; email_record.attempt_count += 1
        add_audit_log(current_user().id, case.case_id, email_record.match_id, 'EMAIL_RETRY_SUCCESS', {'notification_id': email_record.id})
    except Exception as exc:
        email_record.status = 'FAILED'; email_record.failure_reason = str(exc)[:500]; email_record.attempt_count += 1
        add_audit_log(current_user().id, case.case_id, email_record.match_id, 'EMAIL_FAILED', {'notification_id': email_record.id, 'reason': str(exc)[:500]})
        admin_users = User.query.filter_by(role='ADMIN_DEMO').all()
        for admin in admin_users:
            db.session.add(Notification(user_id=admin.id, title='Retry email failed', message=f'Retry attempt for case {case.case_id} failed.', type='warning'))
    db.session.commit(); return jsonify(message='Email retry processed.', email={'id': email_record.id, 'status': email_record.status, 'attempt_count': email_record.attempt_count}), 200


@app.get('/api/notifications')
@require_auth()
def notifications():
    rows = Notification.query.filter_by(user_id=current_user().id).order_by(Notification.created_at.desc()).all(); return jsonify(items=[{'id': n.id, 'title': n.title, 'message': n.message, 'is_read': n.is_read, 'created_at': n.created_at.isoformat()} for n in rows])


@app.put('/api/notifications/<int:nid>/read')
@require_auth()
def read_notification(nid):
    n = db.session.get(Notification, nid)
    if not n or n.user_id != current_user().id:
        return api_error('Notification not found.', 404)
    n.is_read = True; db.session.commit(); return jsonify(message='Marked as read.')


@app.get('/api/dashboard/statistics')
@require_auth()
def stats():
    u = current_user(); cases = MissingPerson.query if u.role in {'INVESTIGATOR', 'ADMIN_DEMO'} else MissingPerson.query.filter_by(registered_by=u.id)
    people = cases.all(); ids = [x.case_id for x in people]
    return jsonify(active_cases=sum(normalize_case_status(x.status) == 'ACTIVE' for x in people), total_cases=len(people), new_sightings=Sighting.query.filter(Sighting.case_id.in_(ids)).count() if ids else 0,
                   potential_matches=AIMatch.query.join(MissingPerson).filter(MissingPerson.case_id.in_(ids)).count() if ids else 0,
                   notifications=Notification.query.filter_by(user_id=u.id, is_read=False).count())


@app.get('/api/emergency-contacts')
@require_auth()
def emergency_contacts():
    rows = EmergencyContact.query.filter_by(is_active=True).all(); return jsonify(items=[{'id': x.id, 'name': x.name, 'phone': x.phone, 'region': x.region, 'instructions': x.instructions} for x in rows])


@app.post('/api/emergency-contacts')
@require_auth({'ADMIN_DEMO'})
def add_emergency_contact():
    d = request.get_json() or {}
    if not d.get('name') or not d.get('phone'):
        return api_error('Name and phone are required.')
    row = EmergencyContact(name=d['name'], phone=d['phone'], region=d.get('region'), instructions=d.get('instructions')); db.session.add(row); db.session.commit(); return jsonify(message='Emergency contact saved.'), 201


@app.get('/api/trusted-contacts')
@require_auth()
def trusted_contacts():
    rows = TrustedContact.query.filter_by(user_id=current_user().id).all(); return jsonify(items=[{'id': x.id, 'name': x.name, 'email': x.email, 'phone': x.phone} for x in rows])


@app.post('/api/trusted-contacts')
@require_auth()
def add_trusted_contact():
    d = request.get_json() or {}
    if not d.get('name') or not (d.get('email') or d.get('phone')):
        return api_error('Name and an email address or phone number are required.')
    row = TrustedContact(user_id=current_user().id, name=d['name'], email=d.get('email'), phone=d.get('phone')); db.session.add(row); db.session.commit(); return jsonify(message='Trusted contact added.', contact={'id': row.id, 'name': row.name, 'email': row.email, 'phone': row.phone}), 201


@app.delete('/api/trusted-contacts/<int:contact_id>')
@require_auth()
def remove_trusted_contact(contact_id):
    row = db.session.get(TrustedContact, contact_id)
    if not row or row.user_id != current_user().id:
        return api_error('Trusted contact not found.', 404)
    db.session.delete(row); db.session.commit(); return jsonify(message='Trusted contact removed.')


@app.post('/api/emergency/sos')
@require_auth()
def activate_sos():
    d = request.get_json() or {}; user = current_user()
    event = EmergencyEvent(user_id=user.id, latitude=d.get('latitude'), longitude=d.get('longitude'), location_name=d.get('location_name'),
                          message=d.get('message') or 'I activated an SOS alert and need assistance.')
    db.session.add(event); db.session.flush()
    location = d.get('location_name') or (f"Coordinates: {d.get('latitude')}, {d.get('longitude')}" if d.get('latitude') is not None else 'Location unavailable')
    body = f'JanRaksha AI SOS from {user.name}. {event.message}\nLocation: {location}\nTime: {event.created_at.strftime("%Y-%m-%d %H:%M UTC")}\n\nContact emergency services if there is immediate danger.'
    contacts = TrustedContact.query.filter_by(user_id=user.id).all(); delivered = []
    for contact in contacts:
        if send_email(contact.email, 'JanRaksha AI SOS alert', body):
            delivered.append(contact.email)
    db.session.add(Notification(user_id=user.id, title='SOS activated', message=f'SOS event #{event.id} activated. Email alerts delivered to {len(delivered)} trusted contacts.', type='emergency'))
    db.session.commit(); return jsonify(message='SOS activated. Trusted contacts were notified where email delivery is configured.', event={'id': event.id, 'status': event.status, 'created_at': event.created_at.isoformat()}, email_deliveries=len(delivered)), 201


@app.put('/api/emergency/sos/<int:event_id>/cancel')
@require_auth()
def cancel_sos(event_id):
    event = db.session.get(EmergencyEvent, event_id)
    if not event or event.user_id != current_user().id:
        return api_error('Emergency event not found.', 404)
    if event.status != 'ACTIVE':
        return api_error('This SOS event is already closed.', 409)
    event.status = 'CANCELLED'; event.cancelled_at = datetime.utcnow(); db.session.add(Notification(user_id=current_user().id, title='SOS cancelled', message=f'SOS event #{event.id} was cancelled.', type='emergency')); db.session.commit(); return jsonify(message='SOS cancelled.')


@app.get('/api/emergency/history')
@require_auth()
def emergency_history():
    rows = EmergencyEvent.query.filter_by(user_id=current_user().id).order_by(EmergencyEvent.created_at.desc()).all(); return jsonify(items=[{'id': x.id, 'status': x.status, 'location_name': x.location_name, 'message': x.message, 'created_at': x.created_at.isoformat(), 'cancelled_at': x.cancelled_at.isoformat() if x.cancelled_at else None} for x in rows])


@app.errorhandler(413)
def too_large(e):
    return api_error('File is too large.', 413)


@app.errorhandler(404)
def spa(e):
    if request.path.startswith('/api/'):
        return api_error('Resource not found.', 404)
    return send_app_index()


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, use_reloader=False)
