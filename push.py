import subprocess

bericht = input("Commit bericht (of Enter voor 'update'): ").strip()
if not bericht:
    bericht = "update"

subprocess.run(["git", "add", "."])
subprocess.run(["git", "commit", "-m", bericht])
subprocess.run(["git", "push"])

print("\nKlaar! Wacht ~1 minuut en check https://thomas61287.github.io/entropie/")