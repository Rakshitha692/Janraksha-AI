import json
import unittest
from unittest.mock import patch

import app as janraksha_app


class HumanVerificationFlowTests(unittest.TestCase):
    def setUp(self):
        janraksha_app.app.config.update(
            TESTING=True,
            SECRET_KEY='test-secret',
            SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
            WTF_CSRF_ENABLED=False,
        )
        with janraksha_app.app.app_context():
            janraksha_app.db.drop_all()
            janraksha_app.db.create_all()

        self.client = janraksha_app.app.test_client()

    def _register_user(self, email='owner@example.com', role='FAMILY_USER'):
        resp = self.client.post(
            '/api/auth/register',
            json={
                'name': 'Owner User',
                'email': email,
                'password': 'StrongPass123!',
                'role': role,
                'terms': True,
                'location': 'Delhi',
            },
        )
        self.assertEqual(resp.status_code, 201)

    def _register_missing_person(self):
        self._register_user(email='owner@example.com')
        with janraksha_app.app.app_context():
            user = janraksha_app.User.query.filter_by(email='owner@example.com').first()
            case = janraksha_app.MissingPerson(
                case_id='JR-2026-0001',
                registered_by=user.id,
                name='Riya Sharma',
                age=22,
                photo='/uploads/test.jpg',
                description='Long black hair',
                last_seen_location='Delhi',
            )
            janraksha_app.db.session.add(case)
            janraksha_app.db.session.flush()
            emb = [0.1, 0.2, 0.3, 0.4]
            janraksha_app.db.session.add(
                janraksha_app.FaceEmbedding(
                    missing_person_id=case.id,
                    embedding_vector=str(emb),
                    model_name='test',
                    embedding_dimension=len(emb),
                )
            )
            janraksha_app.db.session.commit()
            return case

    def test_found_person_report_requires_human_verification_before_email(self):
        self._register_missing_person()
        self.client.post(
            '/api/auth/login',
            json={'email': 'owner@example.com', 'password': 'StrongPass123!'},
        )

        with open('test_image.png', 'wb') as f:
            f.write(b'fake-png-data')

        with janraksha_app.app.app_context():
            case = janraksha_app.MissingPerson.query.first()

        with patch('app.embedding_from_file', return_value=[0.1, 0.2, 0.3]), \
             patch('app.search_embedding', return_value=[{'person': case, 'similarity': 95}]), \
             patch('app.send_case_email') as mocked_email:
            with open('test_image.png', 'rb') as photo:
                resp = self.client.post(
                    '/api/found-persons',
                    data={
                        'description': 'I found this person near the station',
                        'location_name': 'Central station',
                        'latitude': '28.61',
                        'longitude': '77.21',
                        'photo': (photo, 'test_image.png'),
                    },
                    content_type='multipart/form-data',
                )
            self.assertEqual(resp.status_code, 201)
            matched_case = resp.get_json()['matches'][0]['case']
            self.assertEqual(matched_case['case_id'], case.case_id)
            self.assertEqual(matched_case['photo'], '/uploads/test.jpg')
            self.assertTrue(resp.get_json()['chart'].startswith('data:image/png;base64,'))
            self.assertEqual(mocked_email.call_count, 0)

    def test_verified_found_person_sends_email_alert(self):
        self._register_missing_person()
        self.client.post(
            '/api/auth/login',
            json={'email': 'owner@example.com', 'password': 'StrongPass123!'},
        )

        with open('test_image.png', 'wb') as f:
            f.write(b'fake-png-data')

        with janraksha_app.app.app_context():
            case = janraksha_app.MissingPerson.query.first()

        with patch('app.embedding_from_file', return_value=[0.1, 0.2, 0.3]), \
             patch('app.search_embedding', return_value=[{'person': case, 'similarity': 95}]), \
             patch('app.send_case_email') as mocked_email:
            with open('test_image.png', 'rb') as photo:
                resp = self.client.post(
                    '/api/found-persons',
                    data={
                        'description': 'I found this person near the station',
                        'location_name': 'Central station',
                        'latitude': '28.61',
                        'longitude': '77.21',
                        'photo': (photo, 'test_image.png'),
                    },
                    content_type='multipart/form-data',
                )
            report_id = resp.get_json()['report_id']
            confirm = self.client.post(
                f'/api/found-persons/{report_id}/verify',
                json={'case_id': case.case_id, 'location_name': 'Central station', 'verified': True},
            )
            self.assertEqual(confirm.status_code, 200)
            self.assertEqual(mocked_email.call_count, 1)

    def test_ai_search_excludes_case_from_results(self):
        self._register_missing_person()
        self.client.post(
            '/api/auth/login',
            json={'email': 'owner@example.com', 'password': 'StrongPass123!'},
        )

        with open('test_search.png', 'wb') as f:
            f.write(b'fake-search-png')

        with janraksha_app.app.app_context():
            case = janraksha_app.MissingPerson.query.first()

        with patch('app.embedding_from_file', return_value=[0.1, 0.2, 0.3]), \
             patch('app.search_embedding', return_value=[{'person': case, 'similarity': 95}]):
            with open('test_search.png', 'rb') as photo:
                resp = self.client.post(
                    '/api/ai/search',
                    data={'photo': (photo, 'test_search.png'), 'exclude_case_id': case.case_id},
                    content_type='multipart/form-data',
                )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.get_json()['matches'], [])

    def test_search_skips_old_embedding_dimensions_and_returns_compatible_matches(self):
        self._register_missing_person()
        vector = [1.0] + [0.0] * 511
        with janraksha_app.app.app_context():
            case = janraksha_app.MissingPerson.query.first()
            janraksha_app.db.session.add(
                janraksha_app.FaceEmbedding(
                    missing_person_id=case.id,
                    embedding_vector=json.dumps(vector),
                    model_name='current-test-model',
                    embedding_dimension=len(vector),
                )
            )
            janraksha_app.db.session.commit()
            results = janraksha_app.search_embedding(vector)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['person'].case_id, 'JR-2026-0001')
        self.assertEqual(results[0]['similarity'], 99.9)


if __name__ == '__main__':
    unittest.main()
