# git-finalizer — native-sidecar image.
#
# Thin wrapper over alpine/git pinned to a known-good tag. Ships the
# SIGTERM-trap entrypoint that performs commit-and-push when the Pod
# terminates. See entrypoint.sh for the lifecycle contract.
FROM alpine/git:2.45.2

COPY entrypoint.sh /usr/local/bin/git-finalizer
RUN chmod +x /usr/local/bin/git-finalizer

# alpine/git's default ENTRYPOINT runs `git`; reset it so our script is PID 1.
ENTRYPOINT ["/usr/local/bin/git-finalizer"]
CMD []
