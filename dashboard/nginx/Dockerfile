# Frontend Nginx
FROM nginx:stable-alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY frontend/ /usr/share/nginx/html/
EXPOSE 80
# Mount .htpasswd at /etc/nginx/.htpasswd
