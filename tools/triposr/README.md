# Photo-built models (TripoSR)

Vehicles in `public/models` are built from one photograph each with [TripoSR](https://github.com/VAST-AI-Research/TripoSR), running locally on Apple Silicon.

Setup (once; everything it downloads is git-ignored):

    cd tools/triposr
    git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git && (cd TripoSR && git apply ../isosurface.patch)
    uv venv --python 3.11 .venv
    uv pip install --python .venv/bin/python torch torchvision omegaconf==2.3.0 pillow einops transformers==4.35.0 trimesh rembg onnxruntime huggingface-hub "imageio[ffmpeg]" xatlas moderngl scikit-image numpy "setuptools<81"
    ./dl.sh        # the 1.6 GB weights, in parallel resumable pieces (plus config.yaml from the Hugging Face repo, into weights/)

`isosurface.patch` replaces torchmcubes (needs cmake) with scikit-image marching cubes.

Making a model:

1. Find a photo of ONE object, three-quarter view, nothing in front of it. `search.py <tag> "<words>"` searches Wikimedia Commons and
   writes a contact sheet to `refs/cand/`. Record the source in `refs/sources.json`.
2. `cd TripoSR && PYTORCH_ENABLE_MPS_FALLBACK=1 ../.venv/bin/python run.py ../refs/x.jpg --device mps --pretrained-model-name-or-path ../weights --output-dir ../out/x --bake-texture --texture-resolution 2048`
3. `Blender -b -P convert.py -- out/x/0 ../../public/models/x.glb --size W L H [--level] [--rear] --preview out/prev`
   (stretches the mesh to the real size, stands it level, points the front forward, cuts it to 12k triangles, packs a JPEG texture).

What it is good at: the side that was photographed. The far side is invented and plainer. Thin parts (spokes, mirrors) come out thick.
`tools/blender/build_models.py` and `build_vehicles.py` still build the older hand-made models and would overwrite these files.
