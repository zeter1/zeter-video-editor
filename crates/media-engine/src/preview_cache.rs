use std::{
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
};

use crate::MediaError;

pub fn lookup_preview_cache(path: &Path) -> Result<Option<PathBuf>, MediaError> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(MediaError::CacheIo {
                path: path.to_path_buf(),
                source,
            })
        }
    };

    let mut prefix = [0_u8; 12];
    match file.read_exact(&mut prefix) {
        Ok(()) if &prefix[4..8] == b"ftyp" => Ok(Some(path.to_path_buf())),
        Ok(()) => Ok(None),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(None),
        Err(source) => Err(MediaError::CacheIo {
            path: path.to_path_buf(),
            source,
        }),
    }
}
