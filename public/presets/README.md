# Presets

A preset is one capture saved whole by the app's **Save preset** button: the photo, the phone's position, heading and tilt, the OpenStreetMap footprints as they were fetched, the picked building, the marks and the design plan.

To list one on the home page, put the JSON file here and add it to `index.json`:

```json
[{ "file": "my-street.json", "label": "My street, Seoul" }]
```

Open `/?preset=/presets/my-street.json&autoplay=1` to replay it straight into the video (`&size=1080` renders 1080 × 1920).

Before committing a preset to a public repository, check the photo: no faces, no licence plates, no house numbers you do not want to publish.
