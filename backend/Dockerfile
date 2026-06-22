FROM python:3.11.9-slim
WORKDIR /app

# 시스템 의존성
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    curl \
    unzip \
    wget \
    skopeo \
    && rm -rf /var/lib/apt/lists/*

# Terraform 설치
RUN wget -O terraform.zip https://releases.hashicorp.com/terraform/1.14.8/terraform_1.14.8_linux_amd64.zip \
    && unzip terraform.zip \
    && mv terraform /usr/local/bin/ \
    && rm terraform.zip

# tfsec 설치 (버전 고정)
RUN curl -sL https://github.com/aquasecurity/tfsec/releases/download/v1.28.11/tfsec-linux-amd64 \
    -o /usr/local/bin/tfsec \
    && chmod +x /usr/local/bin/tfsec

# Infracost 설치 (버전 고정)
RUN curl -sL https://github.com/infracost/infracost/releases/download/v0.10.39/infracost-linux-amd64.tar.gz \
    -o /tmp/infracost.tar.gz \
    && tar -xzf /tmp/infracost.tar.gz -C /tmp \
    && mv /tmp/infracost-linux-amd64 /usr/local/bin/infracost \
    && rm /tmp/infracost.tar.gz

# gcloud 설치
RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts
ENV PATH $PATH:/root/google-cloud-sdk/bin

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# checkov 설치
RUN pip install checkov

COPY . .
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"]
