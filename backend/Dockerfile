FROM python:3.11.9-slim
WORKDIR /app

# 시스템 의존성
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    curl \
    unzip \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Terraform 설치
RUN wget -O terraform.zip https://releases.hashicorp.com/terraform/1.14.8/terraform_1.14.8_linux_amd64.zip \
    && unzip terraform.zip \
    && mv terraform /usr/local/bin/ \
    && rm terraform.zip

# tfsec 설치
RUN curl -s https://raw.githubusercontent.com/aquasecurity/tfsec/master/scripts/install_linux.sh | bash

# Infracost 설치
RUN curl -fsSL https://raw.githubusercontent.com/infracost/infracost/master/scripts/install.sh | sh

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# checkov 설치 (requirements.txt에 없는 경우 별도 설치)
RUN pip install checkov

COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]