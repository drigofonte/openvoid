# 1. Pod status + which container is unhappy
kubectl get pod -n openvoid-sessions session-01ks6demj97d7phwsyyjnjahey -o wide
kubectl describe pod -n openvoid-sessions session-01ks6demj97d7phwsyyjnjahey | tail -50

# 2. Did workspace-init exit cleanly?
kubectl get pod -n openvoid-sessions session-01ks6demj97d7phwsyyjnjahey \
  -o jsonpath='{range .status.initContainerStatuses[*]}{.name}{": "}{.state}{"\n"}{end}'

# 3. What did the agent container actually do?
kubectl logs -n openvoid-sessions session-01ks6demj97d7phwsyyjnjahey -c session --tail=200