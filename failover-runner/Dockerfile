FROM hashicorp/terraform:1.14.8

RUN apk add --no-cache \
    python3 \
    py3-pip \
    curl \
    bash \
    jq \
    aws-cli

# gcloud CLI 설치
RUN curl -sSL https://sdk.cloud.google.com > /tmp/install.sh && \
    bash /tmp/install.sh --disable-prompts --install-dir=/usr/local && \
    ln -s /usr/local/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud

WORKDIR /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]