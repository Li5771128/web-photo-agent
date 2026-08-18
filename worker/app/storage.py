import boto3

from .config import Settings


class AssetStorage:
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
        )

    def read(self, object_key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=object_key)
        return response["Body"].read()
