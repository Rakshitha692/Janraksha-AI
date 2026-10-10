from app import app, db, User, MissingPerson, Timeline, Notification, EmergencyContact
from werkzeug.security import generate_password_hash
from datetime import datetime
with app.app_context():
    db.create_all()
    if not User.query.filter_by(email='investigator@janraksha.demo').first():
        u=User(name='Demo Investigator',email='investigator@janraksha.demo',phone='0000000000',password_hash=generate_password_hash('DemoPass123!'),role='INVESTIGATOR',location='Synthetic demo region'); db.session.add(u);db.session.flush()
        for i,name in enumerate(['Aarav Kumar','Meera Shah','Kabir Das'],1):
            p=MissingPerson(case_id=f'JR-{datetime.utcnow().year}-{i:04d}',registered_by=u.id,name=name,age=10+i,gender='Not specified',description='Synthetic demonstration record only.',last_seen_location='Demo locality',status='ACTIVE');db.session.add(p);db.session.add(Timeline(case_id=p.case_id,event_type='CASE_REGISTERED',description='Synthetic demo case created.',created_by=u.id))
        db.session.add(Notification(user_id=u.id,title='Demo data ready',message='Synthetic cases are available for testing.',type='info'));db.session.commit();print('Seeded. Login: investigator@janraksha.demo / DemoPass123!')
    if not EmergencyContact.query.first():
        db.session.add(EmergencyContact(name='Local emergency service',phone='CONFIGURE',region='Configure for your region',instructions='An administrator must replace this demo placeholder with a verified local emergency number.'))
        db.session.commit()
