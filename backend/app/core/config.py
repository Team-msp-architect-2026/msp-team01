# backend/app/core/config.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # AWS
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_default_region: str = "us-west-2"

    # AI
    gemini_api_key: str = ""
    bedrock_region: str = "us-west-2"

    # Database
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "autoops"
    db_user: str = "autoops"
    db_password: str = ""

    # Cognito
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    skip_assume_role: bool = False   # 로컬 개발용 AssumeRole bypass

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()