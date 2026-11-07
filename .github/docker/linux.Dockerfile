FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git sudo xz-utils unzip pkg-config tzdata libatomic1 \
    libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev librsvg2-dev \
    libayatana-appindicator3-dev patchelf libfuse2 file xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ARG RUNNER_UID=1000
ARG RUNNER_GID=1000
RUN groupadd --gid "$RUNNER_GID" runner \
    && useradd --uid "$RUNNER_UID" --gid "$RUNNER_GID" --home-dir /github/home --create-home runner \
    && mkdir -p /agent-usage-cache \
    && chown "$RUNNER_UID:$RUNNER_GID" /agent-usage-cache \
    && printf 'runner ALL=(root) NOPASSWD: /usr/bin/apt-get\n' > /etc/sudoers.d/runner \
    && chmod 0440 /etc/sudoers.d/runner
USER runner
