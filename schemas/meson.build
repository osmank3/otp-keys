schema_files = [
    run_command(sh, '-c', ls_cmd.format('*.gschema.xml')).stdout().strip().split('\n'),
]

install_data(
  files(schema_files),
  install_dir: schema_dir
)

meson.add_install_script(sh.path(), '-c', ' '.join([
    'glib-compile-schemas $DESTDIR/@0@'.format(schema_dir),
]))
