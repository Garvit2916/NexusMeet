from app.core.config import get_settings
from app.db.init_db import initialize_database
from app.db.seed import seed_database
from app.db.session import Database


def main() -> None:
    settings = get_settings()
    database = Database(settings.database_url, echo=settings.database_echo)
    try:
        if settings.auto_create_tables:
            initialize_database(database.engine)
        created = seed_database(database, settings)
        action = "created" if created else "already exists"
        print(f"Default user {settings.default_user_email} {action}")
        if settings.seed_sample_data:
            print("Sample meeting data ready")
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
