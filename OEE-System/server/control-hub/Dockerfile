FROM python:3.12.7-slim
RUN pip install --no-cache-dir "paho-mqtt==2.1.0" "psycopg[binary]==3.2.3"
COPY hub.py oee.py /
CMD ["python", "-u", "/hub.py"]
