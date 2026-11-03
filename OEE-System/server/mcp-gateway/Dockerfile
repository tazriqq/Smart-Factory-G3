FROM python:3.12.7-slim
RUN pip install --no-cache-dir "aiohttp==3.10.10"
COPY gateway.py /gateway.py
CMD ["python", "-u", "/gateway.py"]
