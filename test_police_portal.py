import unittest
from io import BytesIO
import tempfile

from werkzeug.security import check_password_hash, generate_password_hash

import app as janraksha_app


class PolicePortalTests(unittest.TestCase):
    def setUp(self):
        self.upload_folder = tempfile.TemporaryDirectory()
        janraksha_app.app.config.update(
            TESTING=True,
            SECRET_KEY='test-secret',
            SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
            UPLOAD_FOLDER=self.upload_folder.name,
        )
        with janraksha_app.app.app_context():
            janraksha_app.db.drop_all()
            janraksha_app.db.create_all()
            janraksha_app.db.session.add_all([
                janraksha_app.User(
                    name='Portal Admin',
                    email='admin@example.com',
                    password_hash=generate_password_hash('AdminPass123!'),
                    role='ADMIN_DEMO',
                ),
                janraksha_app.User(
                    name='Community Reporter',
                    email='reporter@example.com',
                    phone='+911234567890',
                    password_hash=generate_password_hash('ReporterPass123!'),
                    role='CITIZEN',
                ),
            ])
            janraksha_app.db.session.commit()
        self.admin = janraksha_app.app.test_client()
        self.reporter = janraksha_app.app.test_client()
        self.police = janraksha_app.app.test_client()

    def tearDown(self):
        self.upload_folder.cleanup()

    def _login(self, client, email, password):
        response = client.post('/api/auth/login', json={'email': email, 'password': password})
        self.assertEqual(response.status_code, 200)

    def _create_officer(self):
        self._login(self.admin, 'admin@example.com', 'AdminPass123!')
        return self.admin.post('/api/police/officers', json={
            'police_id': 'POL-1001',
            'name': 'Officer Test',
            'email': 'officer@example.com',
            'phone': '+911111111111',
            'password': 'OfficerPass123!',
        })

    def _submit_report(self, key='one-report-token'):
        self._login(self.reporter, 'reporter@example.com', 'ReporterPass123!')
        return self.reporter.post('/api/emergency/cases', data={
            'category': 'ACCIDENT',
            'submission_key': key,
            'reporter_name': 'Community Reporter',
            'reporter_contact': '+911234567890',
            'description': 'A road accident needs police assistance.',
            'location_name': 'Central market',
            'latitude': '28.61',
            'longitude': '77.21',
        })

    def test_police_api_requires_authorized_session(self):
        self.assertEqual(janraksha_app.app.test_client().get('/police').status_code, 200)
        self.assertEqual(self.police.get('/api/police/cases').status_code, 401)
        self.assertEqual(self.police.put('/api/police/cases/EM-NOT-FOUND', json={}).status_code, 401)

    def test_public_users_cannot_self_register_admin_or_police_roles_or_provision_officers(self):
        for role in ('POLICE_OFFICER', 'ADMIN_DEMO'):
            response = janraksha_app.app.test_client().post('/api/auth/register', json={
                'name': 'Untrusted account',
                'email': f'self-{role.lower()}@example.com',
                'password': 'StrongPass123!',
                'role': role,
                'terms': True,
            })
            self.assertEqual(response.status_code, 400)
            with janraksha_app.app.app_context():
                self.assertEqual(
                    janraksha_app.User.query.filter_by(email=f'self-{role.lower()}@example.com').count(),
                    0,
                )
        self._login(self.reporter, 'reporter@example.com', 'ReporterPass123!')
        response = self.reporter.post('/api/police/officers', json={
            'police_id': 'POL-UNTRUSTED',
            'name': 'Untrusted account',
            'email': 'untrusted@example.com',
            'password': 'StrongPass123!',
        })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reporter.get('/api/police/cases').status_code, 403)

    def test_public_registration_supports_family_citizen_and_investigator_roles(self):
        client = janraksha_app.app.test_client()
        for role in ('FAMILY_USER', 'CITIZEN', 'INVESTIGATOR'):
            response = client.post('/api/auth/register', json={
                'name': f'{role} Account',
                'email': f'{role.lower()}-signup@example.com',
                'password': 'StrongPass123!',
                'role': role,
                'terms': True,
            })
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.get_json()['user']['role'], role)

    def test_registration_form_offers_investigator_without_demo_administrator(self):
        with janraksha_app.app.test_client() as client:
            response = client.get('/')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('<option value="INVESTIGATOR">Investigator</option>', html)
        self.assertNotIn('Demo administrator', html)
        self.assertNotIn('authorized accounts only', html)

    def test_admin_provisions_hashed_account_and_police_id_login_works(self):
        response = self._create_officer()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()['officer']['police_id'], 'POL-1001')
        with janraksha_app.app.app_context():
            user = janraksha_app.User.query.filter_by(email='officer@example.com').one()
            self.assertEqual(user.role, 'POLICE_OFFICER')
            self.assertNotEqual(user.password_hash, 'OfficerPass123!')
            self.assertTrue(check_password_hash(user.password_hash, 'OfficerPass123!'))

        wrong_password = self.police.post('/api/police/login', json={
            'identifier': 'POL-1001', 'password': 'wrong',
        })
        self.assertEqual(wrong_password.status_code, 401)
        self.assertIn('incorrect', wrong_password.get_json()['error'])
        login = self.police.post('/api/police/login', json={
            'identifier': 'POL-1001', 'password': 'OfficerPass123!',
        })
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()['user']['role'], 'POLICE_OFFICER')
        self.assertEqual(self.police.get('/api/police/cases').status_code, 200)

    def test_emergency_report_persists_is_filtered_and_status_update_survives_refresh(self):
        self.assertEqual(self._create_officer().status_code, 201)
        report = self._submit_report()
        self.assertEqual(report.status_code, 201)
        case = report.get_json()['case']
        self.assertTrue(case['case_id'].startswith('EM-'))
        self.assertEqual(case['status'], 'PENDING')
        self.assertEqual(case['reporter_contact'], '+911234567890')
        self.assertEqual(case['latitude'], 28.61)

        duplicate = self._submit_report()
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.get_json()['case']['case_id'], case['case_id'])

        self.assertEqual(self.police.get('/api/police/cases').status_code, 401)
        self.police.post('/api/police/login', json={
            'identifier': 'officer@example.com', 'password': 'OfficerPass123!',
        })
        listing = self.police.get('/api/police/cases?category=ACCIDENT&status=PENDING&search=accident').get_json()
        self.assertEqual(listing['total'], 1)
        self.assertEqual(listing['counts']['pending'], 1)
        self.assertEqual(listing['items'][0]['case_id'], case['case_id'])

        update = self.police.put(f"/api/police/cases/{case['case_id']}", json={
            'status': 'IN_PROGRESS',
            'assigned_officer_id': listing['officers'][0]['user_id'],
        })
        self.assertEqual(update.status_code, 200)
        refreshed = self.police.get(f"/api/police/cases/{case['case_id']}").get_json()['case']
        self.assertEqual(refreshed['status'], 'IN_PROGRESS')
        self.assertEqual(refreshed['assigned_officer_name'], 'Officer Test')

        reporter_cases = self.reporter.get('/api/emergency/cases/mine').get_json()['items']
        self.assertEqual(reporter_cases[0]['status'], 'IN_PROGRESS')
        self.assertEqual(self.police.post('/api/police/logout').status_code, 200)
        self.assertEqual(self.police.get('/api/police/cases').status_code, 401)

    def test_invalid_category_coordinates_and_status_are_rejected(self):
        self._login(self.reporter, 'reporter@example.com', 'ReporterPass123!')
        invalid = self.reporter.post('/api/emergency/cases', data={
            'category': 'UNKNOWN',
            'description': 'Invalid report',
            'location_name': 'Somewhere',
        })
        self.assertEqual(invalid.status_code, 400)

        invalid_coordinates = self.reporter.post('/api/emergency/cases', data={
            'category': 'FIRE',
            'description': 'A fire is reported.',
            'location_name': 'Somewhere',
            'latitude': '200',
            'longitude': '181',
        })
        self.assertEqual(invalid_coordinates.status_code, 400)

        self.assertEqual(self._create_officer().status_code, 201)
        report = self._submit_report('status-validation-token')
        self.police.post('/api/police/login', json={
            'identifier': 'POL-1001', 'password': 'OfficerPass123!',
        })
        bad_status = self.police.put(
            f"/api/police/cases/{report.get_json()['case']['case_id']}",
            json={'status': 'CLOSED'},
        )
        self.assertEqual(bad_status.status_code, 400)

    def test_supporting_images_are_saved_and_access_is_limited_to_reporter_and_police(self):
        self._login(self.reporter, 'reporter@example.com', 'ReporterPass123!')
        created = self.reporter.post('/api/emergency/cases', data={
            'category': 'MEDICAL',
            'description': 'A person needs medical attention.',
            'location_name': 'North entrance',
            'attachment': (BytesIO(b'test image bytes'), 'evidence.png'),
        }, content_type='multipart/form-data')
        self.assertEqual(created.status_code, 201)
        case = created.get_json()['case']
        self.assertTrue(case['attachment'].startswith('/api/emergency/case-attachments/'))
        reporter_image = self.reporter.get(case['attachment'])
        self.assertEqual(reporter_image.status_code, 200)
        reporter_image.close()

        second_reporter = janraksha_app.app.test_client()
        with janraksha_app.app.app_context():
            second_user = janraksha_app.User(
                name='Other Citizen',
                email='other@example.com',
                password_hash=generate_password_hash('OtherPass123!'),
                role='CITIZEN',
            )
            janraksha_app.db.session.add(second_user)
            janraksha_app.db.session.commit()
        self._login(second_reporter, 'other@example.com', 'OtherPass123!')
        self.assertEqual(second_reporter.get(case['attachment']).status_code, 403)
        self.assertEqual(janraksha_app.app.test_client().get(case['attachment']).status_code, 401)

        self.assertEqual(self._create_officer().status_code, 201)
        self.police.post('/api/police/login', json={
            'identifier': 'POL-1001', 'password': 'OfficerPass123!',
        })
        police_image = self.police.get(case['attachment'])
        self.assertEqual(police_image.status_code, 200)
        police_image.close()


if __name__ == '__main__':
    unittest.main()
