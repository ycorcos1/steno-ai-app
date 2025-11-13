# StenoAI

AI-powered legal drafting assistant.

## Setup

1. Install dependencies:
   ```bash
   npm install
   npm --prefix apps/web install
   npm --prefix apps/api install
   ```

2. Build artifacts:
   ```bash
   make web-build    # Frontend → apps/web/dist/
   make api-zip      # API → apps/api/dist/api.zip
   make ai-deps      # AI dependencies
   ```

3. Configure environment:
   ```bash
   source scripts/env.sh
   ```

## Structure

- `apps/web/` - React frontend (Vite)
- `apps/api/` - Node.js API (Express on Lambda)
- `apps/ai/` - Python AI service (FastAPI on Lambda)
- `scripts/` - Deployment and utility scripts
