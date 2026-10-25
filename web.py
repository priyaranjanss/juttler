import requests
import json

# API Configuration
API_URL = "https://allaitools-generate.freemodels.workers.dev/api/chat"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    "Origin": "https://rusherai.com",
    "Content-Type": "application/json",
    "Referer": "https://rusherai.com/",
    "Accept": "*/*"
}

def chat_with_ai(prompt):
    try:
        # Prepare the request data with correct format
        data = {
            "messages": [  # This is what the API expects
                {"role": "user", "content": prompt}
            ],
            "stream": False
        }

        # Send the request
        response = requests.post(
            API_URL,
            headers=HEADERS,
            json=data,
            timeout=30
        )

        # Check for successful response
        if response.status_code == 200:
            # Handle SSE (Server-Sent Events) format
            if "text/event-stream" in response.headers.get("Content-Type", ""):
                # For streaming responses
                response.encoding = 'utf-8'
                for line in response.iter_lines():
                    if line:
                        decoded_line = line.decode('utf-8')
                        if decoded_line.startswith("data:"):
                            data = decoded_line[5:].strip()
                            if data:  # Remove empty lines
                                print(data)
            else:
                # For regular JSON responses
                result = response.json()
                if isinstance(result, dict) and 'choices' in result:
                    # Handle chat completion format
                    if result['choices'] and result['choices'][0].get('message'):
                        print(result['choices'][0]['message']['content'])
                    else:
                        print(json.dumps(result, indent=2))
                else:
                    print(json.dumps(result, indent=2))
        else:
            print(f"Error: {response.status_code} - {response.text}")
            return None

    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return None

# Example usage
if __name__ == "__main__":
    print("AI Chat (type 'exit' to quit)")
    while True:
        user_input = input("You: ")
        if user_input.lower() in ['exit', 'quit']:
            break

        print("AI: Thinking...")
        chat_with_ai(user_input)