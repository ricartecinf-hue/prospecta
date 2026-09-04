# Imagem da primeira DM do Sinapsi

Coloque o arquivo de imagem aprovado em `assets/sinapsi.jpg`.

O worker de outreach só envia a primeira DM de psicologia quando esse arquivo
existe. Se o arquivo estiver ausente, o job falha antes de reservar a cota de
DM — o texto nunca é enviado sem a imagem.

Para usar outro caminho no deploy, defina `SINAPSI_DM_IMAGE_PATH` com um caminho
absoluto ou relativo ao diretório do projeto.
