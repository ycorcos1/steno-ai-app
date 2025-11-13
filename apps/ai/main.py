import os
import json
import boto3
from fastapi import FastAPI, HTTPException
from mangum import Mangum
from pydantic import BaseModel
from botocore.exceptions import ClientError

app = FastAPI()

# Initialize Bedrock client
bedrock_region = os.getenv("BEDROCK_REGION", "us-east-1")
bedrock_model_id = os.getenv(
    "BEDROCK_MODEL_ID",
    "anthropic.claude-3-5-sonnet-20240620-v1:0",
)

bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=bedrock_region,
)


class GenerateRequest(BaseModel):
    prompt: str


@app.get("/health")
@app.get("/prod/health")
def health():
    return {"status": "ok"}


@app.post("/generate")
@app.post("/prod/generate")
def generate(request: GenerateRequest):
    """
    Generate text using Amazon Bedrock Claude model
    """
    try:
        # Prepare the request body for Claude
        body = json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 4096,
                "temperature": 0.7,
                "messages": [
                    {
                        "role": "user",
                        "content": request.prompt,
                    }
                ],
            }
        )

        # Invoke Bedrock
        response = bedrock_runtime.invoke_model(
            modelId=bedrock_model_id,
            body=body,
            contentType="application/json",
            accept="application/json",
        )

        # Parse response
        response_body = json.loads(response["body"].read())
        
        # Extract text from Claude's response format
        # Claude returns: {"content": [{"type": "text", "text": "..."}]}
        text_content = ""
        if "content" in response_body:
            for content_block in response_body["content"]:
                if content_block.get("type") == "text":
                    text_content += content_block.get("text", "")
        
        if not text_content:
            raise HTTPException(
                status_code=500,
                detail="No text content in Bedrock response",
            )

        return {"text": text_content}

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        error_message = e.response.get("Error", {}).get("Message", str(e))
        print(f"Bedrock ClientError: {error_code} - {error_message}")
        raise HTTPException(
            status_code=500,
            detail=f"Bedrock invocation failed: {error_code} - {error_message}",
        )
    except json.JSONDecodeError as e:
        print(f"JSON decode error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to parse Bedrock response",
        )
    except Exception as e:
        print(f"Unexpected error in generate: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Generation failed: {str(e)}",
        )


handler = Mangum(app)
