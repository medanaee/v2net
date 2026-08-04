import re

store_path = r'd:\Projects\v2ray-test\src\store\useConfigStore.ts'
with open(store_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Update signature
content = content.replace(
    "resetResultsForIds: (targetIds: string[], mode: 'realDelay' | 'speed') => void;",
    "resetResultsForIds: (targetIds: string[], mode: 'realDelay' | 'speed' | 'hybrid') => void;"
)

# Update implementation signature
content = content.replace(
    "resetResultsForIds: (targetIds: string[], mode: 'realDelay' | 'speed') => {",
    "resetResultsForIds: (targetIds: string[], mode: 'realDelay' | 'speed' | 'hybrid') => {"
)

# Update testMode type
content = content.replace(
    "setTestMode: (mode: 'realDelay' | 'speed') => set({ testMode: mode }),",
    "setTestMode: (mode: 'realDelay' | 'speed' | 'hybrid') => set({ testMode: mode }),"
)
content = re.sub(r'testMode:\s*(?:\'realDelay\'|\'speed\'|\'hybrid\'),', "testMode: 'realDelay',", content)

with open(store_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated useConfigStore.ts")
