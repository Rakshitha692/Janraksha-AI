import argparse
from getpass import getpass
import re

from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash

from app import PoliceOfficer, User, app, db


def main():
    parser = argparse.ArgumentParser(
        description='Provision a Police Portal account from a trusted server environment.'
    )
    parser.add_argument('--police-id', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--email', required=True)
    parser.add_argument('--phone', default='')
    args = parser.parse_args()

    password = getpass('New police account password (minimum 8 characters): ')
    confirmation = getpass('Confirm password: ')
    if len(password) < 8 or password != confirmation:
        parser.error('Passwords must match and contain at least 8 characters.')

    with app.app_context():
        db.create_all()
        email = args.email.strip().lower()
        police_id = args.police_id.strip()
        if (not re.fullmatch(r'[A-Za-z0-9_-]{3,40}', police_id)
                or not args.name.strip() or len(args.name.strip()) > 120
                or len(email) > 160 or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email)):
            parser.error('Use a valid Police ID, name, and registered email.')
        if User.query.filter_by(email=email).first() or PoliceOfficer.query.filter(
            db.func.lower(PoliceOfficer.police_id) == police_id.lower()
        ).first():
            parser.error('That email or Police ID is already registered.')

        user = User(
            name=args.name.strip(),
            email=email,
            phone=args.phone.strip() or None,
            password_hash=generate_password_hash(password),
            role='POLICE_OFFICER',
        )
        db.session.add(user)
        try:
            db.session.flush()
            db.session.add(PoliceOfficer(user_id=user.id, police_id=police_id))
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            parser.error('That email or Police ID is already registered.')
        print(f'Police account provisioned: {police_id} ({email})')


if __name__ == '__main__':
    main()
