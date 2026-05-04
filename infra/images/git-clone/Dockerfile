# git-clone — initContainer image.
#
# Thin wrapper over alpine/git pinned to a known-good tag. Ships the
# clone script that pulls the user repo into /workspace/repo at Pod
# startup. See clone.sh for the contract.
FROM alpine/git:2.45.2

COPY clone.sh /usr/local/bin/git-clone
RUN chmod +x /usr/local/bin/git-clone

# alpine/git's default ENTRYPOINT runs `git`; reset it so our script
# is invoked directly.
ENTRYPOINT ["/usr/local/bin/git-clone"]
CMD []
