FROM python:3.12-slim
WORKDIR /app
COPY services/runtime /app/services/runtime
RUN pip install --no-cache-dir ./services/runtime
COPY deploy/run.py deploy/backup.py /app/deploy/
RUN useradd --uid 10001 --create-home runtime
USER 10001:10001
ENV RUNTIME_HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080
CMD ["python", "/app/deploy/run.py"]
