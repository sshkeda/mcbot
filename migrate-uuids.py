#!/usr/bin/env python3
"""
Migrate player data from online-mode UUIDs to offline-mode UUIDs.
Offline UUID = UUID v3 (MD5) of "OfflinePlayer:<name>"

Run as root inside Docker so we can overwrite files from previous
failed migration, then chown to the correct UID.
"""
import hashlib
import os
import shutil
import uuid

DATA_DIR = "/data" if os.path.exists("/data/world") else "/srv/blockgame-server/data"
TARGET_UID = 1124200035
TARGET_GID = 1124200035

# Online-mode UUID -> player name mappings (from usercache)
PLAYERS = {
    "09f03a4d-b3f9-4d5e-8457-27869bbb9dd9": "TNTbros101",
    "0caec4bb-581d-480b-a5aa-1bddfd5d2175": "Cartorson",
    "2fe1d1db-8af1-429a-8b2a-9a9ca60eccc3": "verymuchaddicted",
    "47b3b262-a4ce-478f-83f2-35a71e3016b6": "AutismSupport",
    "5642c527-26d9-4c5b-948c-e6d3098ef626": "ITTABD",
    "d69a6568-35d1-47b7-8d8e-027fb85eddf2": "PhantomEnergy",
}

def offline_uuid(name):
    """Compute offline-mode UUID (same as Java's UUID.nameUUIDFromBytes)"""
    data = ("OfflinePlayer:" + name).encode("utf-8")
    md5 = hashlib.md5(data).digest()
    md5_bytes = bytearray(md5)
    md5_bytes[6] = (md5_bytes[6] & 0x0F) | 0x30  # version 3
    md5_bytes[8] = (md5_bytes[8] & 0x3F) | 0x80  # IETF variant
    return str(uuid.UUID(bytes=bytes(md5_bytes)))

def copy_and_chown(src, dst):
    """Copy file, overwrite dest, set correct ownership."""
    if not os.path.exists(src):
        return False
    # Remove existing dest if it exists (might be root-owned)
    if os.path.exists(dst):
        os.remove(dst)
    shutil.copy2(src, dst)
    os.chown(dst, TARGET_UID, TARGET_GID)
    os.chmod(dst, 0o600)
    print(f"  {os.path.basename(src)} -> {os.path.basename(dst)}")
    return True

def main():
    world = os.path.join(DATA_DIR, "world")

    # Directories to migrate: (subdir, extension)
    targets = [
        ("playerdata", ".dat"),
        ("playerdata", ".dat_old"),
        ("advancements", ".json"),
        ("stats", ".json"),
    ]

    print("UUID Migration: online -> offline")
    print("=" * 60)

    for online_uuid_str, name in PLAYERS.items():
        new_uuid = offline_uuid(name)
        print(f"\n{name}:")
        print(f"  online:  {online_uuid_str}")
        print(f"  offline: {new_uuid}")

        if online_uuid_str == new_uuid:
            print("  SKIP: same UUID")
            continue

        for subdir, ext in targets:
            src = os.path.join(world, subdir, online_uuid_str + ext)
            dst = os.path.join(world, subdir, new_uuid + ext)
            if not copy_and_chown(src, dst):
                if ext != ".dat_old":  # don't warn about missing _old files
                    print(f"  WARNING: {subdir}/{online_uuid_str + ext} not found")

    print("\n" + "=" * 60)
    print("Migration complete!")
    print(f"All files owned by UID:GID {TARGET_UID}:{TARGET_GID}")

if __name__ == "__main__":
    main()
