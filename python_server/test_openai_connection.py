import os
import openai
from dotenv import load_dotenv
import requests
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("test_openai")

# Load environment variables from .env file
load_dotenv()

# Get OpenAI API configuration
api_key = os.getenv("OPENAI_API_KEY")
api_base = os.getenv("OPENAI_API_BASE")

logger.info(f"OpenAI API Key: {api_key[:5]}...{api_key[-5:] if api_key else None}")
logger.info(f"OpenAI Base URL: {api_base}")

# Test using the OpenAI SDK
def test_openai_sdk():
    try:
        # Configure OpenAI client
        openai.api_key = api_key
        
        if api_base:
            # Ensure base URL ends with /v1
            if not api_base.endswith('/v1'):
                openai.base_url = f"{api_base}/v1"
            else:
                openai.base_url = api_base
        
        logger.info("Testing OpenAI API connection using SDK...")
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a mathematical analysis assistant."},
                {"role": "user", "content": "Hello, can you help analyze mathematical solutions?"}
            ],
            max_tokens=50
        )
        
        logger.info(f"SDK Response: {response.choices[0].message.content}")
        logger.info("✅ OpenAI SDK test successful!")
        return True
        
    except Exception as e:
        logger.error(f"❌ OpenAI SDK test failed: {str(e)}")
        return False

# Test using direct HTTP requests
def test_openai_requests():
    try:
        base_url = api_base
        
        # Ensure base URL ends with /v1
        if not base_url.endswith('/v1'):
            base_url = f"{base_url}/v1"
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are a mathematical analysis assistant."},
                {"role": "user", "content": "Hello, can you help analyze mathematical solutions?"}
            ],
            "max_tokens": 50,
            "temperature": 0.3
        }
        
        logger.info("Testing OpenAI API connection using direct HTTP request...")
        response = requests.post(
            f"{base_url}/chat/completions", 
            headers=headers,
            json=payload,
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            content = result["choices"][0]["message"]["content"]
            logger.info(f"HTTP Response: {content}")
            logger.info("✅ OpenAI HTTP test successful!")
            return True
        else:
            logger.error(f"❌ OpenAI HTTP test failed with status {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        logger.error(f"❌ OpenAI HTTP test failed: {str(e)}")
        return False

if __name__ == "__main__":
    sdk_success = test_openai_sdk()
    
    if not sdk_success:
        logger.info("Trying alternative method...")
        http_success = test_openai_requests()
        
        if http_success:
            logger.info("✅ Connection test passed using HTTP requests")
            logger.info("You should use the alternative method in your main application")
        else:
            logger.error("❌ All connection tests failed")
            logger.error("Please check your API key, base URL, and network connection")
    else:
        logger.info("✅ Connection test passed using OpenAI SDK")
        logger.info("You can use the SDK in your main application") 