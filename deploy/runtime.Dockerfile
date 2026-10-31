FROM python:3.12-slim
WORKDIR /app
COPY services/runtime /app/services/runtime
RUN pip install --no-cache-dir ./services/runtime
ENV RUNTIME_HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080
CMD ["ishop-runtime"]
