import os

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

model = SentenceTransformer(EMBEDDING_MODEL)

app = FastAPI(title="Provenance Embedding Service")


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]
    model: str
    dimensions: int


class HealthResponse(BaseModel):
    status: str
    model: str


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", model=EMBEDDING_MODEL)


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    vector = model.encode(req.text).tolist()
    return EmbedResponse(
        embedding=vector,
        model=EMBEDDING_MODEL,
        dimensions=len(vector),
    )
