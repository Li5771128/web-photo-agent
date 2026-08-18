import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    redis_url: str
    s3_endpoint: str
    s3_region: str
    s3_access_key: str
    s3_secret_key: str
    s3_bucket: str
    dashscope_api_key: str
    dashscope_base_url: str
    dashscope_model: str
    vision_max_edge: int
    vision_jpeg_quality: int

    @classmethod
    def from_env(cls) -> "Settings":
        max_edge = int(os.getenv("VISION_MAX_EDGE", "1024"))
        jpeg_quality = int(os.getenv("VISION_JPEG_QUALITY", "80"))
        if not 256 <= max_edge <= 2048:
            raise ValueError("VISION_MAX_EDGE must be between 256 and 2048")
        if not 40 <= jpeg_quality <= 95:
            raise ValueError("VISION_JPEG_QUALITY must be between 40 and 95")
        return cls(
            database_url=os.environ["DATABASE_URL"],
            redis_url=os.environ["REDIS_URL"],
            s3_endpoint=os.environ["S3_ENDPOINT"],
            s3_region=os.getenv("S3_REGION", "us-east-1"),
            s3_access_key=os.environ["S3_ACCESS_KEY"],
            s3_secret_key=os.environ["S3_SECRET_KEY"],
            s3_bucket=os.environ["S3_BUCKET"],
            dashscope_api_key=os.getenv("DASHSCOPE_API_KEY", "").strip(),
            dashscope_base_url=os.getenv(
                "DASHSCOPE_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ).rstrip("/"),
            dashscope_model=os.getenv("DASHSCOPE_MODEL", "qwen3.7-max"),
            vision_max_edge=max_edge,
            vision_jpeg_quality=jpeg_quality,
        )
