import os
import requests

TOKEN = os.getenv("BOT_TOKEN")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")

def handler(request):
    url = f"{WEBHOOK_URL}/api/webhook"
    r = requests.get(f"https://api.telegram.org/bot{TOKEN}/setWebhook?url={url}")
    return r.text
