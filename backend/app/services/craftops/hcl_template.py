# backend/app/services/craftops/hcl_template.py
"""
Python 템플릿 기반 Terraform HCL 생성.

수정 이력:
- v1: 초기 생성
- v2: tfsec ignore 주석 위치 수정, AVD-AWS-0054 HTTP redirect 적용
- v3: backend 블록 제거 (-backend=false와 충돌)
- v4: 4개 버그 수정
  ① RDS subnet group name 소문자 처리
  ② RDS identifier 소문자 처리
  ③ RDS engine: 'postgresql' → 'postgres'
  ④ parameter_group_name: 'default.postgresql15' → 'default.postgres15'
- v5: include_backend 파라미터 추가
- v6: 5개 버그 수정
  ① listener redirect → forward (TG-ALB 연결 에러 수정)
  ② ECS Service depends_on lb_listener 추가
  ③ RDS deletion_protection = false (destroy 시 에러 수정)
  ④ IAM Role logs:CreateLogGroup 인라인 정책 추가
  ⑤ NAT Gateway depends_on igw 추가
"""


def generate_hcl(config_snapshot: dict, include_backend: bool = True) -> str:
    project_id  = config_snapshot.get("project_id", "unknown")
    prefix      = config_snapshot.get("prefix", "APP")
    environment = config_snapshot.get("environment", "prod")
    region      = config_snapshot.get("region", "us-west-2")

    network     = config_snapshot.get("network", {})
    vpc_cidr    = network.get("vpc_cidr", "10.0.0.0/16")
    subnet_auto = network.get("subnet_auto", {
        "public_a":  "10.0.1.0/24",
        "public_c":  "10.0.2.0/24",
        "private_a": "10.0.10.0/24",
        "private_c": "10.0.20.0/24",
    })
    pub_a  = subnet_auto.get("public_a",  "10.0.1.0/24")
    pub_c  = subnet_auto.get("public_c",  "10.0.2.0/24")
    prv_a  = subnet_auto.get("private_a", "10.0.10.0/24")
    prv_c  = subnet_auto.get("private_c", "10.0.20.0/24")

    app_tier      = config_snapshot.get("app_tier", {})
    vcpu          = app_tier.get("vcpu", 1)
    memory        = app_tier.get("memory", 2048)
    container_img = app_tier.get("container_image", "nginx:latest")
    ecs_preset    = app_tier.get("ecs_preset", {})
    min_tasks     = ecs_preset.get("min_tasks", 2)
    max_tasks     = ecs_preset.get("max_tasks", 10)
    cpu_target    = ecs_preset.get("autoscaling_target_cpu", 70)
    cw_retention  = ecs_preset.get("cw_log_retention_days", 90)

    data_tier      = config_snapshot.get("data_tier", {})
    rds_preset     = data_tier.get("rds_preset", {})
    multi_az       = str(rds_preset.get("multi_az", True)).lower()
    backup_days    = rds_preset.get("backup_retention_days", 30)
    encrypted      = str(rds_preset.get("storage_encrypted", True)).lower()
    rds_class      = rds_preset.get("instance_class", "db.t3.medium")
    rds_engine_raw = rds_preset.get("engine", "postgresql")
    rds_engine     = "postgres" if rds_engine_raw == "postgresql" else rds_engine_raw
    rds_version    = rds_preset.get("engine_version", "15")

    p         = f"{prefix}-{environment}"
    p_lower   = f"{prefix}-{environment}".lower()
    cpu_units = int(vcpu * 1024)

    if include_backend:
        terraform_block = (
            "terraform {\n"
            "  required_providers {\n"
            "    aws = {\n"
            '      source  = "hashicorp/aws"\n'
            '      version = "~> 5.0"\n'
            "    }\n"
            "  }\n"
            "\n"
            '  backend "s3" {\n'
            '    bucket         = "autoops-terraform-state"\n'
            f'    key            = "projects/{project_id}/terraform.tfstate"\n'
            '    region         = "us-west-2"\n'
            '    dynamodb_table = "autoops-terraform-lock"\n'
            "    encrypt        = true\n"
            "  }\n"
            "}"
        )
    else:
        terraform_block = (
            "terraform {\n"
            "  required_providers {\n"
            "    aws = {\n"
            '      source  = "hashicorp/aws"\n'
            '      version = "~> 5.0"\n'
            "    }\n"
            "  }\n"
            "}"
        )

    return f"""# ============================================================
# AutoOps 자동 생성 Terraform HCL
# project_id: {project_id}
# prefix: {prefix} / environment: {environment} / region: {region}
# ============================================================

{terraform_block}

provider "aws" {{
  region = "{region}"
}}

# ── VPC ───────────────────────────────────────────────────────────────

resource "aws_vpc" "{p}-vpc" {{
  cidr_block           = "{vpc_cidr}"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {{
    Name        = "{p}-vpc"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── Subnets ────────────────────────────────────────────────────────────

resource "aws_subnet" "{p}-subnet-public-a" {{
  vpc_id                  = aws_vpc.{p}-vpc.id
  cidr_block              = "{pub_a}"
  availability_zone       = "{region}a"
  map_public_ip_on_launch = true

  tags = {{
    Name        = "{p}-subnet-public-a"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

resource "aws_subnet" "{p}-subnet-public-c" {{
  vpc_id                  = aws_vpc.{p}-vpc.id
  cidr_block              = "{pub_c}"
  availability_zone       = "{region}c"
  map_public_ip_on_launch = true

  tags = {{
    Name        = "{p}-subnet-public-c"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

resource "aws_subnet" "{p}-subnet-private-a" {{
  vpc_id            = aws_vpc.{p}-vpc.id
  cidr_block        = "{prv_a}"
  availability_zone = "{region}a"

  tags = {{
    Name        = "{p}-subnet-private-a"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

resource "aws_subnet" "{p}-subnet-private-c" {{
  vpc_id            = aws_vpc.{p}-vpc.id
  cidr_block        = "{prv_c}"
  availability_zone = "{region}c"

  tags = {{
    Name        = "{p}-subnet-private-c"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── Internet Gateway ───────────────────────────────────────────────────

resource "aws_internet_gateway" "{p}-igw" {{
  vpc_id = aws_vpc.{p}-vpc.id

  tags = {{
    Name        = "{p}-igw"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── NAT Gateway ────────────────────────────────────────────────────────

resource "aws_eip" "{p}-nat-eip" {{
  domain = "vpc"

  tags = {{
    Name        = "{p}-nat-eip"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

resource "aws_nat_gateway" "{p}-nat" {{
  allocation_id = aws_eip.{p}-nat-eip.id
  subnet_id     = aws_subnet.{p}-subnet-public-a.id

  depends_on = [aws_internet_gateway.{p}-igw]

  tags = {{
    Name        = "{p}-nat"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── Route Tables ───────────────────────────────────────────────────────

resource "aws_route_table" "{p}-rt-public" {{
  vpc_id = aws_vpc.{p}-vpc.id

  route {{
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.{p}-igw.id
  }}

  tags = {{
    Name        = "{p}-rt-public"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

resource "aws_route_table_association" "{p}-rta-public-a" {{
  subnet_id      = aws_subnet.{p}-subnet-public-a.id
  route_table_id = aws_route_table.{p}-rt-public.id
}}

resource "aws_route_table_association" "{p}-rta-public-c" {{
  subnet_id      = aws_subnet.{p}-subnet-public-c.id
  route_table_id = aws_route_table.{p}-rt-public.id
}}

resource "aws_route_table" "{p}-rt-private" {{
  vpc_id = aws_vpc.{p}-vpc.id

  route {{
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.{p}-nat.id
  }}

  tags = {{
    Name        = "{p}-rt-private"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

resource "aws_route_table_association" "{p}-rta-private-a" {{
  subnet_id      = aws_subnet.{p}-subnet-private-a.id
  route_table_id = aws_route_table.{p}-rt-private.id
}}

resource "aws_route_table_association" "{p}-rta-private-c" {{
  subnet_id      = aws_subnet.{p}-subnet-private-c.id
  route_table_id = aws_route_table.{p}-rt-private.id
}}

# ── Security Groups ─────────────────────────────────────────────────────

#tfsec:ignore:AVD-AWS-0107
#tfsec:ignore:AVD-AWS-0104
resource "aws_security_group" "{p}-sg-alb" {{
  name        = "{p}-sg-alb"
  description = "ALB inbound HTTP/HTTPS"
  vpc_id      = aws_vpc.{p}-vpc.id

  ingress {{
    description = "Allow HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }}

  ingress {{
    description = "Allow HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }}

  egress {{
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }}

  tags = {{
    Name        = "{p}-sg-alb"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

#tfsec:ignore:AVD-AWS-0104
resource "aws_security_group" "{p}-sg-app" {{
  name        = "{p}-sg-app"
  description = "App inbound from ALB"
  vpc_id      = aws_vpc.{p}-vpc.id

  ingress {{
    description     = "Allow 8080 from ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.{p}-sg-alb.id]
  }}

  egress {{
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }}

  tags = {{
    Name        = "{p}-sg-app"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

#tfsec:ignore:AVD-AWS-0104
resource "aws_security_group" "{p}-sg-db" {{
  name        = "{p}-sg-db"
  description = "DB inbound from App"
  vpc_id      = aws_vpc.{p}-vpc.id

  ingress {{
    description     = "Allow 5432 from App"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.{p}-sg-app.id]
  }}

  egress {{
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }}

  tags = {{
    Name        = "{p}-sg-db"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── ALB ────────────────────────────────────────────────────────────────

resource "aws_lb" "{p}-alb" {{
  name               = "{p}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.{p}-sg-alb.id]
  subnets = [
    aws_subnet.{p}-subnet-public-a.id,
    aws_subnet.{p}-subnet-public-c.id,
  ]

  drop_invalid_header_fields = true

  tags = {{
    Name        = "{p}-alb"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

resource "aws_lb_target_group" "{p}-tg" {{
  name        = "{p}-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.{p}-vpc.id
  target_type = "ip"

  health_check {{
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }}

  tags = {{
    Name        = "{p}-tg"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# [v6 수정①] redirect → forward (TG-ALB 연결 보장)
resource "aws_lb_listener" "{p}-listener-http" {{
  load_balancer_arn = aws_lb.{p}-alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {{
    type             = "forward"
    target_group_arn = aws_lb_target_group.{p}-tg.arn
  }}

  tags = {{
    Name        = "{p}-listener-http"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── IAM Role ───────────────────────────────────────────────────────────

resource "aws_iam_role" "{p}-iam-role" {{
  name = "{p}-iam-role"

  assume_role_policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [{{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = {{ Service = "ecs-tasks.amazonaws.com" }}
    }}]
  }})

  tags = {{
    Name        = "{p}-iam-role"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

resource "aws_iam_role_policy_attachment" "{p}-iam-policy" {{
  role       = aws_iam_role.{p}-iam-role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}}

# [v6 수정④] logs:CreateLogGroup 인라인 정책 추가
resource "aws_iam_role_policy" "{p}-iam-logs-policy" {{
  name = "{p}-iam-logs-policy"
  role = aws_iam_role.{p}-iam-role.id

  policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [{{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup"]
      Resource = "*"
    }}]
  }})
}}

# ── CloudWatch Log Group ────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "{p}-cw-log" {{
  name              = "/ecs/{p}-app"
  retention_in_days = {cw_retention}

  tags = {{
    Name        = "{p}-cw-log"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── ECS Cluster ────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "{p}-ecs-cluster" {{
  name = "{p}-ecs-cluster"

  tags = {{
    Name        = "{p}-ecs-cluster"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── ECS Task Definition ─────────────────────────────────────────────────

resource "aws_ecs_task_definition" "{p}-ecs-task-def" {{
  family                   = "{p}-ecs-task-def"
  cpu                      = "{cpu_units}"
  memory                   = "{memory}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.{p}-iam-role.arn

  container_definitions = jsonencode([{{
    name      = "{p}-app"
    image     = "{container_img}"
    cpu       = {cpu_units}
    memory    = {memory}
    essential = true
    portMappings = [{{
      containerPort = 8080
      hostPort      = 8080
      protocol      = "tcp"
    }}]
    logConfiguration = {{
      logDriver = "awslogs"
      options = {{
        "awslogs-group"         = "/ecs/{p}-app"
        "awslogs-region"        = "{region}"
        "awslogs-stream-prefix" = "ecs"
      }}
    }}
  }}])

  tags = {{
    Name        = "{p}-ecs-task-def"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── ECS Service ─────────────────────────────────────────────────────────

resource "aws_ecs_service" "{p}-ecs-service" {{
  name            = "{p}-ecs-service"
  cluster         = aws_ecs_cluster.{p}-ecs-cluster.id
  task_definition = aws_ecs_task_definition.{p}-ecs-task-def.arn
  desired_count   = {min_tasks}
  launch_type     = "FARGATE"

  # [v6 수정②] 리스너 생성 완료 후 ECS Service 생성
  depends_on = [aws_lb_listener.{p}-listener-http]

  network_configuration {{
    subnets = [
      aws_subnet.{p}-subnet-private-a.id,
      aws_subnet.{p}-subnet-private-c.id,
    ]
    security_groups  = [aws_security_group.{p}-sg-app.id]
    assign_public_ip = false
  }}

  load_balancer {{
    target_group_arn = aws_lb_target_group.{p}-tg.arn
    container_name   = "{p}-app"
    container_port   = 8080
  }}

  deployment_circuit_breaker {{
    enable   = true
    rollback = true
  }}

  tags = {{
    Name        = "{p}-ecs-service"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── Auto Scaling ────────────────────────────────────────────────────────

resource "aws_appautoscaling_target" "{p}-ecs-scaling-target" {{
  max_capacity       = {max_tasks}
  min_capacity       = {min_tasks}
  resource_id        = "service/${{aws_ecs_cluster.{p}-ecs-cluster.name}}/${{aws_ecs_service.{p}-ecs-service.name}}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}}

resource "aws_appautoscaling_policy" "{p}-ecs-scaling-policy" {{
  name               = "{p}-ecs-scaling-policy"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.{p}-ecs-scaling-target.resource_id
  scalable_dimension = aws_appautoscaling_target.{p}-ecs-scaling-target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.{p}-ecs-scaling-target.service_namespace

  target_tracking_scaling_policy_configuration {{
    predefined_metric_specification {{
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }}
    target_value       = {cpu_target}
    scale_in_cooldown  = 300
    scale_out_cooldown = 300
  }}
}}

# ── RDS Subnet Group ────────────────────────────────────────────────────

resource "aws_db_subnet_group" "{p}-rds-subnet-group" {{
  name = "{p_lower}-rds-subnet-group"
  subnet_ids = [
    aws_subnet.{p}-subnet-private-a.id,
    aws_subnet.{p}-subnet-private-c.id,
  ]

  tags = {{
    Name        = "{p}-rds-subnet-group"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}

# ── RDS Instance ────────────────────────────────────────────────────────

resource "aws_db_instance" "{p}-rds" {{
  identifier              = "{p_lower}-rds"
  allocated_storage       = 20
  storage_type            = "gp3"
  engine                  = "{rds_engine}"
  engine_version          = "{rds_version}"
  instance_class          = "{rds_class}"
  db_name                 = "appdb"
  username                = "dbadmin"
  password                = "AutoOps2026!"
  parameter_group_name    = "default.{rds_engine}{rds_version}"
  multi_az                = {multi_az}
  db_subnet_group_name    = aws_db_subnet_group.{p}-rds-subnet-group.name
  vpc_security_group_ids  = [aws_security_group.{p}-sg-db.id]
  skip_final_snapshot     = true
  backup_retention_period = {backup_days}
  storage_encrypted       = {encrypted}
  deletion_protection     = false

  tags = {{
    Name        = "{p}-rds"
    Environment = "{environment}"
    Project     = "{project_id}"
  }}
}}
"""