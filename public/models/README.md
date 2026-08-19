# Shipped models

Empty on purpose. See `docs/MODELS.md`.

SignBridge refuses to load an ONNX model that is not listed in `manifest.json`
with a matching SHA-256. To ship one:

1. Train and export it (`/training`).
2. Copy the `.onnx` here.
3. Add an entry to `manifest.json`, including the hash:
   `node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" model.onnx`
4. Write its model card in `docs/MODELS.md`. A model without a card does not ship.

Until then the app runs on its geometric baseline plus whatever the user has
calibrated locally, and says so.
