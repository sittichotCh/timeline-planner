package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"timeline-planner/internal/config"
	"timeline-planner/internal/handler"
	"timeline-planner/internal/store"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	yamlStore, err := store.New(cfg.DataDir)
	if err != nil {
		log.Fatalf("failed to initialize store: %v", err)
	}

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		// Accept any localhost origin so the dev server works regardless of
		// which port Vite binds to (5173, 5174, …). See allowLocalhostOrigin.
		AllowOriginFunc:  allowLocalhostOrigin,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	api := r.Group("/api")
	{
		members := api.Group("/members")
		{
			h := handler.NewMembers(yamlStore)
			members.GET("", h.List)
			members.PUT("/reorder", h.Reorder)
			members.POST("", h.Create)
			members.PUT("/:email", h.Update)
			members.DELETE("/:email", h.Delete)
		}

		events := api.Group("/events")
		{
			h := handler.NewEvents(yamlStore)
			events.GET("", h.List)
			events.GET("/:email", h.ListByMember)
			events.POST("", h.Create)
			events.PUT("/:id", h.Update)
			events.DELETE("/:id", h.Delete)
		}

		tasks := api.Group("/tasks")
		{
			h := handler.NewTasks(yamlStore)
			tasks.GET("", h.List)
			tasks.PUT("/reorder", h.Reorder)
			tasks.GET("/:email", h.ListByMember)
			tasks.POST("", h.Upsert)
			tasks.DELETE("/:task_id", h.Delete)
		}

		deadlines := api.Group("/deadlines")
		{
			h := handler.NewDeadlines(yamlStore)
			deadlines.GET("", h.List)
			deadlines.POST("", h.Create)
			deadlines.PUT("/:id", h.Update)
			deadlines.DELETE("/:id", h.Delete)
		}

		jira := api.Group("/jira")
		{
			h := handler.NewJira(cfg)
			jira.GET("/config", h.Config)
			jira.POST("/sync", h.Sync)
		}
	}

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Serve frontend static files
	staticDir := filepath.Join(filepath.Dir(os.Args[0]), "..", "..", "frontend", "dist")
	if envStatic := os.Getenv("STATIC_DIR"); envStatic != "" {
		staticDir = envStatic
	}
	if info, err := os.Stat(staticDir); err == nil && info.IsDir() {
		r.Static("/assets", filepath.Join(staticDir, "assets"))
		r.StaticFile("/favicon.ico", filepath.Join(staticDir, "favicon.ico"))
		r.NoRoute(func(c *gin.Context) {
			c.File(filepath.Join(staticDir, "index.html"))
		})
		log.Printf("Serving frontend from %s", staticDir)
	}

	log.Printf("Server starting on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
