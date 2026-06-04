# backend/app/services/mirrorops/gcp_auth.py

import boto3
import json
import os
import tempfile


def load_gcp_credentials() -> str:
    """
    AWS Secrets Manager에서 공유 GCP SA Key를 로드하고
    임시 파일로 저장한 후 경로를 반환한다.
    개발/테스트 환경에서 GCP 미연동 프로젝트의 폴백으로 사용된다.
    """
    client   = boto3.client("secretsmanager", region_name="us-west-2")
    secret   = client.get_secret_value(SecretId="autoops/gcp-sa-key")
    key_data = json.loads(secret["SecretString"])

    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(key_data, tmp)
    tmp.close()
    return tmp.name


def setup_gcp_auth(project=None) -> None:
    """
    GOOGLE_APPLICATION_CREDENTIALS 환경변수를 설정한다.

    project가 있고 gcp_secret_arn이 설정된 경우:
        → 해당 프로젝트의 SA 키 사용 (사용자 GCP 프로젝트)
    없거나 미연동인 경우:
        → 공유 autoops/gcp-sa-key 사용 (개발/테스트용)
    """
    if project and getattr(project, "gcp_secret_arn", None):
        # 프로젝트별 SA 키 사용
        client   = boto3.client("secretsmanager", region_name="us-west-2")
        secret   = client.get_secret_value(SecretId=project.gcp_secret_arn)
        key_data = json.loads(secret["SecretString"])

        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        json.dump(key_data, tmp)
        tmp.close()
        key_path = tmp.name
    else:
        # 폴백: 공유 SA 키 (개발/테스트 환경)
        key_path = load_gcp_credentials()

    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path