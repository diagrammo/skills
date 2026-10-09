from app.greet import greet
from . import shout


def main() -> None:
    print(shout.shout(greet("world")))
