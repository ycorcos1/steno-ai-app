.PHONY: web-build web-deploy api-zip api-deploy ai-zip ai-deploy ai-deps buckets-create lifecycle-config all

web-build:
	@echo "Building frontend..."
	npm --prefix apps/web run build

web-deploy:
	@echo "Deploying frontend to S3 + CloudFront..."
	bash scripts/web_create.sh

api-zip:
	@echo "Building and packaging API..."
	npm --prefix apps/api run build

api-deploy:
	@echo "Deploying API to Lambda..."
	bash scripts/api_create.sh

ai-zip:
	@echo "Building and packaging AI service..."
	bash apps/ai/scripts/build.sh

ai-deploy:
	@echo "Deploying AI service to Lambda..."
	bash scripts/ai_create.sh

buckets-create:
	@echo "Creating S3 buckets..."
	bash scripts/data_buckets_create.sh

lifecycle-config:
	@echo "Configuring S3 lifecycle policies..."
	bash scripts/s3_lifecycle.sh

ai-deps:
	@echo "Installing AI dependencies..."
	cd apps/ai && pip install -r requirements.txt

all: web-build api-zip ai-zip ai-deps buckets-create
