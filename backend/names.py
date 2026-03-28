import random

_ADJECTIVES = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
    "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa",
    "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey",
    "Xray", "Yankee", "Zulu",
]

_NOUNS = [
    "Fox", "Bear", "Hawk", "Wolf", "Eagle", "Shark", "Tiger", "Cobra",
    "Viper", "Raven", "Storm", "Flash", "Ghost", "Blade", "Scout", "Ranger",
    "Falcon", "Lynx", "Puma", "Bison", "Condor", "Drake", "Frost", "Steel",
]


def generate_name() -> str:
    return random.choice(_ADJECTIVES) + random.choice(_NOUNS)
