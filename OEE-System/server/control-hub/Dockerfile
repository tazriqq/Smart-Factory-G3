FROM python:3.12.7-slim
RUN pip install --no-cache-dir "paho-mqtt==2.1.0"
COPY hub.py /hub.py
CMD ["python", "-u", "/hub.py"]
