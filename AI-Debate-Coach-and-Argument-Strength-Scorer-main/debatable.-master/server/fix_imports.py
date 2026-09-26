#!/usr/bin/env python3
with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find where the imports end (look for logging.basicConfig)
import_end = content.find('logging.basicConfig')
before_imports = """import os
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from groq import Groq
from dotenv import load_dotenv
import requests
from typing import Optional
from pydantic import BaseModel
import logging
import tempfile
import hashlib
import jwt
from datetime import datetime, timedelta
import sqlite3

"""

after_imports = content[import_end:]

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(before_imports + after_imports)

print("File fixed successfully!")
