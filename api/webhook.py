from telegram.ext import Application
from telegram import Update
import functions_framework
from bot import build_app

app_instance = build_app()

@functions_framework.http
def webhook(request):
    if request.method == "POST":
        update = Update.de_json(request.get_json(force=True), app_instance.bot)
        app_instance.process_update(update)
        return "OK", 200
    return "Webhook is active", 200
