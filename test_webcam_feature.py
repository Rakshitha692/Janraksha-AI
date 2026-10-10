from io import BytesIO

import cv2
import numpy as np
import pytest
from unittest.mock import patch

from app import (
    AIMatch,
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
