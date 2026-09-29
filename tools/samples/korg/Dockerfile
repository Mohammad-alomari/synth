# Tools for build_korg.py: ConvertWithMoss (Korg KMP/KSF -> SoundFont 2, LGPL-3.0, https://www.mossgrabers.de/Software/ConvertWithMoss/)
# plus the Python/ffmpeg setup of the pack builder. Build: docker build -t trinity-korg tools/samples/korg
FROM ubuntu:24.04
ARG CWM=20.3.0
ARG CWM_SHA256=3540a95ec67dfe521fea1087a514b0e63c80519a47a359dedd96a61823313a2a
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 python3-numpy python3-scipy python3-soundfile \
      libasound2t64 libfreetype6 libfontconfig1 libx11-6 libxext6 libxrender1 libxtst6 libxi6 \
 && curl -sSfL -o /tmp/cwm.deb https://www.mossgrabers.de/Software/ConvertWithMoss/ConvertWithMoss-Installers-ubuntu-latest/convertwithmoss_${CWM}_amd64.deb \
 && echo "${CWM_SHA256}  /tmp/cwm.deb" | sha256sum -c - \
 && dpkg-deb -x /tmp/cwm.deb / && rm -rf /tmp/cwm.deb /var/lib/apt/lists/*
# (the package's install script only adds a desktop menu entry, so the files are unpacked directly)
ENV PATH=/opt/convertwithmoss/bin:$PATH
