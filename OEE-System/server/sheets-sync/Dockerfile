FROM python:3.12.7-slim
RUN pip install --no-cache-dir "psycopg[binary]==3.2.3"
COPY sync.py /sync.py
CMD ["python", "-u", "/sync.py"]
