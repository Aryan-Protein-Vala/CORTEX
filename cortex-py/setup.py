from setuptools import setup

setup(
    name="cortex-py",
    version="1.1.0",
    description="CORTEX core client for Python: remember(), recall() and the cortex:// graph resolver. Standard library only.",
    long_description=open("README.md").read() if __import__("os").path.exists("README.md") else "",
    long_description_content_type="text/markdown",
    author="Aryan Sharma",
    license="AGPL-3.0-or-later",
    packages=["cortex_py"],
    install_requires=[],
    python_requires=">=3.9",
    keywords=["cortex", "memory", "knowledge-graph", "llm", "mcp"],
    url="https://github.com/Aryan-Protein-Vala/CORTEX",
    project_urls={
        "Source": "https://github.com/Aryan-Protein-Vala/CORTEX",
        "Issues": "https://github.com/Aryan-Protein-Vala/CORTEX/issues",
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: GNU Affero General Public License v3 or later (AGPLv3+)",
        "Programming Language :: Python :: 3",
        "Topic :: Database",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
    ],
)
