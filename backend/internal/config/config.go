package config

import (
	"log"

	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	Port        string `envconfig:"PORT" default:"8080"`
	DataDir     string `envconfig:"DATA_DIR" default:"./data"`
	JiraBaseURL string `envconfig:"JIRA_BASE_URL"`
	JiraEmail   string `envconfig:"JIRA_EMAIL"`
	JiraToken   string `envconfig:"JIRA_TOKEN"`
}

func Load() *Config {
	_ = godotenv.Load()

	var cfg Config
	if err := envconfig.Process("", &cfg); err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	return &cfg
}
