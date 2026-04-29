from pydantic_settings import BaseSettings
from pydantic import ConfigDict

class Settings(BaseSettings):
    model_config = ConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore"        # ← 이게 핵심, 알 수 없는 환경변수 무시
    )

    # AWS
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_default_region: str = "us-west-2"
    aws_session_token: str = ""
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
    skip_assume_role: bool = False
    # MirrorOps SQS
    mirrorops_queue_url: str = ""
    # GCP
    gcp_project_id: str = ""
    gcp_region: str = "us-west1"

    # infracost
    infracost_api_key: str = ""

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

settings = Settings()