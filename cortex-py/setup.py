from setuptools import setup, find_packages

setup(
    name="cortex-sdk",
    version="1.0.0",
    description="Cortex SDK for resolving and injecting graph memory via the cortex:// protocol.",
    author="Aryan Sharma",
    packages=find_packages(),
    install_requires=[
        "requests>=2.25.1",
    ],
    python_requires=">=3.7",
)
