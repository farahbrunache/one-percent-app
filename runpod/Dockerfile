# The RunPod Serverless worker image.
#
# Nothing here is built or pushed by an ordinary change to this repository. The workflow that
# builds it runs only when somebody presses it, because the image is gigabytes and the model
# inside it changes a few times a year at most.

FROM ollama/ollama:latest

# The model is a build argument rather than a runtime setting, because it is baked in. To run
# a different one, build the image again with a different value and point the endpoint at the
# new tag -- the old tag keeps working while that happens.
ARG OLLAMA_MODEL=llama3.2
ENV OLLAMA_MODEL=${OLLAMA_MODEL}

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip curl \
 && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages runpod requests

# Pull the model at build time. A cold start already costs tens of seconds; downloading a
# model on top of that would put every first draft past any budget worth having.
RUN (ollama serve &) \
 && for _ in $(seq 1 60); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 1; done \
 && ollama pull "$OLLAMA_MODEL"

COPY handler.py /handler.py

# The base image runs ollama itself. Here the handler is the process, and it starts Ollama.
ENTRYPOINT []
CMD ["python3", "-u", "/handler.py"]
