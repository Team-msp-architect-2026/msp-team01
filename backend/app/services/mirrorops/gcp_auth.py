import boto3
import json
import os
import tempfile


def load_gcp_credentials() -> str:
    """
    AWS Secrets Manager에서 GCP SA Key를 로드하고
    임시 파일로 저장한 후 경로를 반환한다. (§5-4)

    ECS Task Role이 secretsmanager:GetSecretValue 권한을 보유하므로
    추가 자격증명 없이 조회 가능하다.
    """
    client = boto3.client("secretsmanager", region_name="us-west-2")
    secret  = client.get_secret_value(SecretId="autoops/gcp-sa-key")
    key_data = json.loads(secret["SecretString"])

    # 컨테이너 수명 동안만 존재하는 임시 파일로 저장
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    )
    json.dump(key_data, tmp)
    tmp.close()

    return tmp.name


def setup_gcp_auth() -> None:
    """
    GOOGLE_APPLICATION_CREDENTIALS 환경변수를 설정한다.
    이후 GCP SDK / terraform GCP provider가 자동으로 인증한다.
    """
    key_path = load_gcp_credentials()
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path