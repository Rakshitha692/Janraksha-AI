from io import BytesIO
import json
import tempfile

import cv2
import numpy as np
import pytest
from unittest.mock import patch

from app import (
    AIMatch,
    FaceEmbedding,
    WebcamDetection,
    WebcamSession,
    app,
    assess_face_quality,
    db,
    detect_multiple_faces,
    User,
    webcam_tracks,
)


@pytest.fixture
def client():
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    with app.app_context():
        webcam_tracks.clear()
        db.create_all()
        yield app.test_client()
        webcam_tracks.clear()
        db.session.remove()
        db.drop_all()


def create_user(email='investigator@example.com', role='INVESTIGATOR'):
    user = User(
        name='Investigator Demo',
        email=email,
        phone='1234567890',
        password_hash='pbkdf2:sha256:260000$dummy$placeholder',
        role=role,
        location='Demo city',
    )
    db.session.add(user)
    db.session.commit()
    return user


def make_face_frame(offset=0, alpha=1.0, beta=0):
    image = np.full((220, 200, 3), 155, dtype=np.uint8)
    center_x, center_y = 100 + offset, 110
    cv2.ellipse(image, (center_x, center_y), (55, 78), 0, 0, 360, (92, 108, 126), -1)
    cv2.ellipse(image, (center_x - 22, center_y - 18), (9, 6), 0, 0, 360, (25, 30, 35), -1)
    cv2.ellipse(image, (center_x + 22, center_y - 18), (9, 6), 0, 0, 360, (25, 30, 35), -1)
    cv2.line(image, (center_x, center_y - 12), (center_x - 4, center_y + 20), (40, 45, 50), 4)
    cv2.ellipse(image, (center_x, center_y + 40), (23, 8), 0, 0, 180, (35, 35, 40), 3)
    return cv2.convertScaleAbs(image, alpha=alpha, beta=beta)


def test_webcam_start_requires_auth(client):
    response = client.post('/api/ai/webcam/start', json={})
    assert response.status_code == 401


def test_investigator_can_start_webcam_session(client):
    user = create_user()
    with client.session_transaction() as sess:
        sess['user_id'] = user.id

    response = client.post('/api/ai/webcam/start', json={'location_name': 'Majestic Bus Station'})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['session']['session_id'].startswith('WC-')
    assert payload['session']['status'] == 'ACTIVE'


@pytest.mark.parametrize('role', ['CITIZEN', 'FAMILY_USER'])
def test_community_user_can_create_view_and_stop_their_own_webcam_session(client, role):
    user = create_user(email=f'{role.lower()}@example.com', role=role)
    with client.session_transaction() as sess:
        sess['user_id'] = user.id

    started = client.post('/api/ai/webcam/start', json={})
    assert started.status_code == 200
    session_id = started.get_json()['session']['session_id']

    details = client.get(f'/api/ai/webcam/session/{session_id}')
    assert details.status_code == 200
    assert details.get_json()['session']['investigator_id'] == user.id
    assert client.get(f'/api/ai/webcam/session/{session_id}/matches').status_code == 200

    stopped = client.post('/api/ai/webcam/stop', json={'session_id': session_id})
    assert stopped.status_code == 200
    assert stopped.get_json()['session']['status'] == 'STOPPED'


def test_community_users_cannot_access_another_users_webcam_session(client):
    owner = create_user(email='owner@example.com', role='CITIZEN')
    with client.session_transaction() as sess:
        sess['user_id'] = owner.id
    started = client.post('/api/ai/webcam/start', json={})
    session_id = started.get_json()['session']['session_id']

    other_user = create_user(email='other@example.com', role='FAMILY_USER')
    with client.session_transaction() as sess:
        sess['user_id'] = other_user.id

    assert client.get(f'/api/ai/webcam/session/{session_id}').status_code == 403
    assert client.get(f'/api/ai/webcam/session/{session_id}/matches').status_code == 403
    assert client.post('/api/ai/webcam/stop', json={'session_id': session_id}).status_code == 403
    assert client.post(
        '/api/ai/webcam/process-frame',
        data={'session_id': session_id},
    ).status_code == 403


def test_process_frame_detects_multiple_tracked_faces_with_ai_evidence_statuses(client):
    user = create_user()
    with client.session_transaction() as sess:
        sess['user_id'] = user.id
    session_response = client.post('/api/ai/webcam/start', json={})
    session_id = session_response.get_json()['session']['session_id']

    _, encoded_frame = cv2.imencode('.jpg', np.full((240, 320, 3), 120, dtype=np.uint8))
    frame_data = encoded_frame.tobytes()
    detected_faces = [
        {'x': 20, 'y': 25, 'width': 100, 'height': 110},
        {'x': 180, 'y': 30, 'width': 70, 'height': 80},
    ]
    moved_faces = [
        {'x': 25, 'y': 28, 'width': 100, 'height': 110},
        {'x': 184, 'y': 34, 'width': 70, 'height': 80},
    ]
    with patch('app.detect_multiple_faces', side_effect=[detected_faces, moved_faces]), \
         patch('app.generate_embedding', return_value=np.ones(9216, dtype=np.float32)), \
         patch('app.search_missing_persons', side_effect=[
             [{'person': type('Case', (), {'case_id': 'JR-2025-0001'})(), 'similarity': 92.0, 'combined_score': 92.0}],
             [{'person': type('Case', (), {'case_id': 'JR-2025-0002'})(), 'similarity': 64.0, 'combined_score': 64.0}],
             [{'person': type('Case', (), {'case_id': 'JR-2025-0001'})(), 'similarity': 92.0, 'combined_score': 92.0}],
             [{'person': type('Case', (), {'case_id': 'JR-2025-0002'})(), 'similarity': 64.0, 'combined_score': 64.0}],
         ]):
        for expected_faces in (detected_faces, moved_faces):
            response = client.post(
                '/api/ai/webcam/process-frame',
                data={
                    'session_id': session_id,
                    'frame': (BytesIO(frame_data), 'frame.jpg'),
                },
                content_type='multipart/form-data',
            )
            assert response.status_code == 200
            payload = response.get_json()
            assert payload['faces_detected'] == 2
            assert payload['potential_matches'] in {1, 2}
            assert [face['status'] for face in payload['faces']] == ['POTENTIAL_MATCH', 'NO_RELEVANT_MATCH']
            assert [face['bbox'] for face in payload['faces']] == expected_faces
            assert [box['label'] for box in payload['face_boxes']] == ['Face 1', 'Face 2']
            assert [box['status'] for box in payload['face_boxes']] == ['POTENTIAL_MATCH', 'NO_RELEVANT_MATCH']

    face_results = response.get_json()['faces']
    assert [face['face_id'] for face in face_results] == ['face_01', 'face_02']
    with app.app_context():
        assert WebcamDetection.query.filter_by(session_id=session_id).count() == 4
        assert WebcamDetection.query.filter_by(session_id=session_id, status='POTENTIAL_MATCH').count() == 2
        session_record = WebcamSession.query.filter_by(session_id=session_id).first()
        assert session_record.faces_processed == 4


def test_registered_face_reference_matches_webcam_with_small_image_changes(client):
    user = create_user()
    with client.session_transaction() as sess:
        sess['user_id'] = user.id

    reference = make_face_frame()
    changed_frame = make_face_frame(offset=4, alpha=0.92, beta=10)
    _, reference_jpeg = cv2.imencode('.jpg', reference)
    _, changed_jpeg = cv2.imencode('.jpg', changed_frame)
    reference_box = {'x': 45, 'y': 32, 'width': 110, 'height': 156}
    changed_box = {'x': 49, 'y': 32, 'width': 110, 'height': 156}
    upload_folder = tempfile.TemporaryDirectory()
    previous_upload_folder = app.config['UPLOAD_FOLDER']
    app.config['UPLOAD_FOLDER'] = upload_folder.name
    try:
        with patch('app.detect_multiple_faces', side_effect=[
            [reference_box],
            [changed_box],
            [reference_box],
        ]):
            registered = client.post(
                '/api/missing-persons',
                data={
                    'name': 'Reference Person',
                    'last_seen_location': 'Test location',
                    'photo': (BytesIO(reference_jpeg.tobytes()), 'reference.jpg'),
                },
                content_type='multipart/form-data',
            )
            assert registered.status_code == 201
            person = registered.get_json()['person']
            embedding = FaceEmbedding.query.filter_by(missing_person_id=person['id']).one()
            assert embedding.embedding_dimension == 96 * 96

            legacy_descriptor = np.ones(32 * 16, dtype=np.float32)
            legacy_descriptor /= np.linalg.norm(legacy_descriptor)
            embedding.embedding_vector = json.dumps(legacy_descriptor.tolist())
            embedding.embedding_dimension = legacy_descriptor.size
            db.session.commit()

            started = client.post('/api/ai/webcam/start', json={})
            assert started.status_code == 200
            session_id = started.get_json()['session']['session_id']
            result = client.post(
                '/api/ai/webcam/process-frame',
                data={
                    'session_id': session_id,
                    'frame': (BytesIO(changed_jpeg.tobytes()), 'changed-frame.jpg'),
                },
                content_type='multipart/form-data',
            )
            assert result.status_code == 200
            face = result.get_json()['faces'][0]
            assert face['status'] == 'POTENTIAL_MATCH'
            assert face['case_id'] == person['case_id']
            assert face['similarity_score'] >= 65
            assert embedding.embedding_dimension == 96 * 96
    finally:
        app.config['UPLOAD_FOLDER'] = previous_upload_folder
        upload_folder.cleanup()


def test_face_quality_rejects_too_small_and_extremely_dark_faces():
    small_face = np.full((40, 40, 3), 120, dtype=np.uint8)
    dark_face = np.zeros((100, 100, 3), dtype=np.uint8)
    distorted_face = np.full((80, 160, 3), 120, dtype=np.uint8)

    assert assess_face_quality(small_face) == (False, 'The detected face is too small.')
    assert assess_face_quality(dark_face) == (False, 'The detected face is too dark.')
    assert assess_face_quality(distorted_face) == (False, 'The detected face geometry is distorted.')


def test_face_detection_normalizes_contrast_and_checks_smaller_faces():
    image = np.full((240, 320, 3), 120, dtype=np.uint8)
    detections = np.array([[180, 30, 70, 80], [20, 25, 100, 110]])
    expected_gray = cv2.equalizeHist(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))

    with patch('app.cv2.imread', return_value=image), patch('app.cv2.CascadeClassifier', create=True) as classifier:
        classifier.return_value.empty.return_value = False
        classifier.return_value.detectMultiScale.return_value = detections

        faces = detect_multiple_faces('webcam-frame.jpg')

    input_image, = classifier.return_value.detectMultiScale.call_args.args
    assert np.array_equal(input_image, expected_gray)
    assert classifier.return_value.detectMultiScale.call_args.kwargs == {
        'scaleFactor': 1.1,
        'minNeighbors': 4,
        'minSize': (32, 32),
    }
    assert faces == [
        {'x': 20, 'y': 25, 'width': 100, 'height': 110},
        {'x': 180, 'y': 30, 'width': 70, 'height': 80},
    ]


def test_face_detection_explains_how_to_run_with_unsupported_opencv():
    image = np.full((240, 320, 3), 120, dtype=np.uint8)

    with patch('app.cv2.imread', return_value=image), \
         patch('app.cv2.__version__', '5.0.0'), \
         patch('app._safe_haar_cascade', return_value=None):
        with pytest.raises(ValueError, match=r'OpenCV 5\.0\.0.*\.venv\\Scripts\\python\.exe'):
            detect_multiple_faces('webcam-frame.jpg')
